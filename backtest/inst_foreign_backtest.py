"""
기관 3일 연속 순매수 종목 백테스트 (+ 외국인 동시 순매수 조건)

전략
  - 신호일 D: 기관합계 순매수대금이 D-2, D-1, D 3거래일 연속 > 0
  - 조건 B(외국인 동반): 위 조건 + 같은 3일 동안 외국인 순매수대금도 연속 > 0
  - 진입: D+1 시가 매수
  - 청산: 진입일로부터 N거래일 뒤 종가 매도 (N = 1..10)
      N=1 → D+2 종가, N=10 → D+11 종가
  - 수익률은 KRX 등락률(권리락·액면분할 반영)을 체인해서 계산하므로 분할로 인한 왜곡이 없다.
  - 비교용 벤치마크: 같은 기간 전 종목을 아무 날이나 D+1 시가에 샀을 때의 평균(무조건부 수익률)

데이터: pykrx (KRX 정보데이터시스템). 날짜별 전 종목을 받아 상장폐지 종목도 포함한다.
       첫 실행은 KRX 요청이 수천 건이라 시간이 걸리며, 결과는 ./cache 에 저장되어 재실행은 빠르다.

사용법
  pip install pykrx pandas numpy
  python inst_foreign_backtest.py                 # 최근 3년
  python inst_foreign_backtest.py --years 3 --cost 0.25 --min-value 1e9
"""

import argparse
import os
import time
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

HOLD_DAYS = range(1, 11)
MARKETS = ("KOSPI", "KOSDAQ")
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")


# ---------------------------------------------------------------- 데이터 수집
def _cached(name, fetch):
    path = os.path.join(CACHE_DIR, f"{name}.pkl")
    if os.path.exists(path):
        return pd.read_pickle(path)
    for attempt in range(4):
        try:
            df = fetch()
            break
        except Exception as e:  # KRX 일시 오류 재시도
            if attempt == 3:
                raise
            print(f"  재시도 {name}: {e}")
            time.sleep(2 ** attempt)
    df.to_pickle(path)
    time.sleep(0.2)  # KRX 과호출 방지
    return df


def load_panels(start, end):
    """날짜 x 종목 패널(open, close, ret, value, inst, frgn)을 만든다."""
    from pykrx import stock

    os.makedirs(CACHE_DIR, exist_ok=True)
    idx = _cached(f"days_{start}_{end}", lambda: stock.get_index_ohlcv_by_date(start, end, "1001"))
    days = [d.strftime("%Y%m%d") for d in idx.index]
    print(f"거래일 {len(days)}일 ({days[0]} ~ {days[-1]}) 수집 시작")

    rows = {k: {} for k in ("open", "close", "ret", "value", "inst", "frgn")}
    for i, d in enumerate(days, 1):
        ohlcv = _cached(f"ohlcv_{d}", lambda d=d: stock.get_market_ohlcv(d, market="ALL"))
        rows["open"][d] = ohlcv["시가"]
        rows["close"][d] = ohlcv["종가"]
        rows["ret"][d] = ohlcv["등락률"] / 100.0
        rows["value"][d] = ohlcv["거래대금"]
        for key, investor in (("inst", "기관합계"), ("frgn", "외국인")):
            parts = [
                _cached(
                    f"net_{investor}_{m}_{d}",
                    lambda d=d, m=m, inv=investor: stock.get_market_net_purchases_of_equities(d, d, m, inv),
                )["순매수거래대금"]
                for m in MARKETS
            ]
            rows[key][d] = pd.concat(parts)
        if i % 50 == 0 or i == len(days):
            print(f"  {i}/{len(days)} {d}")

    panels = {}
    for k, v in rows.items():
        df = pd.DataFrame(v).T
        df.index = pd.to_datetime(df.index)
        panels[k] = df.sort_index()
    return panels


# ---------------------------------------------------------------- 백테스트
def forward_returns(panels, n):
    """행 D 에 'D+1 시가 매수 → D+1+n 종가 매도' 수익률을 둔다."""
    o, c, r = panels["open"], panels["close"], panels["ret"]
    tradable = (o > 0) & (c > 0) & (panels["value"] > 0)
    ci = (1 + r.where(tradable, 0.0).fillna(0.0)).cumprod()  # 수정주가 누적지수
    intraday = (c / o).where(tradable)                       # 진입일 시가→종가
    after = ci.shift(-n) / ci                                # 진입일 종가→N일 뒤 종가
    # 청산일까지 거래정지·상장폐지 없이 존재해야 유효
    alive = tradable.astype(float).iloc[::-1].rolling(n + 1, min_periods=n + 1).min().iloc[::-1]
    fwd = intraday * after - 1
    fwd = fwd.where(alive == 1)
    return fwd.shift(-1)  # 신호일 D 기준으로 정렬


def signals(panels, streak=3, min_value=0.0):
    inst = panels["inst"].reindex_like(panels["close"])
    frgn = panels["frgn"].reindex_like(panels["close"])
    inst_ok = (inst > 0).astype(int).rolling(streak).sum() == streak
    frgn_ok = (frgn > 0).astype(int).rolling(streak).sum() == streak
    liquid = panels["value"] >= min_value
    return {
        "A. 기관 3일 연속": inst_ok & liquid,
        "B. 기관+외국인 3일 연속": inst_ok & frgn_ok & liquid,
    }


def summarize(trades, cost):
    t = trades.dropna()
    net = t - cost
    if len(t) == 0:
        return dict(trades=0)
    wins, losses = net[net > 0].sum(), -net[net < 0].sum()
    return {
        "trades": len(t),
        "win_rate%": (net > 0).mean() * 100,
        "avg%": t.mean() * 100,
        "avg_net%": net.mean() * 100,
        "median_net%": net.median() * 100,
        "per_day_net%": net.mean() * 100,  # 아래에서 N으로 나눔
        "profit_factor": wins / losses if losses > 0 else np.inf,
        "t_stat": net.mean() / (net.std(ddof=1) / np.sqrt(len(net))) if len(net) > 1 else np.nan,
    }


def run_backtest(panels, cost=0.0025, min_value=0.0, streak=3):
    sigs = signals(panels, streak, min_value)
    liquid = panels["value"] >= min_value
    results = []
    for n in HOLD_DAYS:
        fwd = forward_returns(panels, n)
        groups = dict(sigs)
        groups["벤치마크(전 종목 무조건)"] = liquid
        for name, mask in groups.items():
            s = summarize(fwd.where(mask.reindex_like(fwd).fillna(False)).stack(), cost)
            s.update(strategy=name, hold=n)
            if s["trades"]:
                s["per_day_net%"] /= n
            results.append(s)
    cols = ["strategy", "hold", "trades", "win_rate%", "avg%", "avg_net%",
            "median_net%", "per_day_net%", "profit_factor", "t_stat"]
    return pd.DataFrame(results)[cols]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--years", type=float, default=3)
    ap.add_argument("--end", default=None, help="YYYYMMDD (기본: 오늘)")
    ap.add_argument("--cost", type=float, default=0.25, help="왕복 거래비용 %% (수수료+거래세+슬리피지)")
    ap.add_argument("--min-value", type=float, default=1e9, help="신호일 최소 거래대금(원), 저유동성 제외")
    ap.add_argument("--streak", type=int, default=3)
    ap.add_argument("--out", default="backtest_result.csv")
    args = ap.parse_args()

    end_dt = datetime.strptime(args.end, "%Y%m%d") if args.end else datetime.today()
    # 청산용으로 끝에 +10거래일이 필요하므로 앞쪽 3년을 온전히 신호 기간으로 쓰도록 여유를 둔다
    start = (end_dt - timedelta(days=int(365 * args.years) + 10)).strftime("%Y%m%d")
    panels = load_panels(start, end_dt.strftime("%Y%m%d"))

    res = run_backtest(panels, cost=args.cost / 100, min_value=args.min_value, streak=args.streak)
    res.to_csv(args.out, index=False, encoding="utf-8-sig")

    pd.set_option("display.width", 200)
    pd.set_option("display.float_format", "{:.3f}".format)
    for name, g in res.groupby("strategy", sort=False):
        print(f"\n=== {name} ===")
        print(g.drop(columns="strategy").to_string(index=False))

    print("\n=== 최적 보유기간 (거래비용 차감 평균수익률 기준) ===")
    for name, g in res[~res.strategy.str.startswith("벤치마크")].groupby("strategy", sort=False):
        best = g.loc[g["avg_net%"].idxmax()]
        eff = g.loc[g["per_day_net%"].idxmax()]
        print(f"{name}: {int(best.hold)}일 보유 → 평균 {best['avg_net%']:.2f}%, 승률 {best['win_rate%']:.1f}% "
              f"| 일평균 효율 최고 {int(eff.hold)}일 ({eff['per_day_net%']:.3f}%/일)")
    print(f"\n결과 저장: {args.out}")


if __name__ == "__main__":
    main()
