"""
기관 3일 연속 순매수 종목 백테스트 (+ 외국인 동시 순매수 조건)

전략
  - 신호일 D: 기관합계 순매수대금이 D-2, D-1, D 3거래일 연속 > 0
  - 조건 B(외국인 동반): 위 조건 + 같은 3일 동안 외국인 순매수대금도 연속 > 0
  - 진입: D+1 시가 매수
  - 청산: 진입일로부터 N거래일 뒤 종가 매도 (N = 1..10)
      N=1 → D+2 종가, N=10 → D+11 종가
  - 중복 진입 금지: 4일, 5일… 연속 순매수가 이어져도 이미 보유 중이면 새로 사지 않고
    기존 보유분을 원래 청산일까지 그대로 유지한다. 청산 이후 다시 신호가 나면 재진입.
  - 청산일이 거래정지면 거래가 재개되는 첫날 종가에 매도한다.
  - 보유 중 상장폐지(이후 데이터에서 종목이 사라짐)되면 수익률 -100%로 처리한다.
  - 수익률은 KRX 등락률(권리락·액면분할 반영)을 체인해서 계산하므로 분할로 인한 왜곡이 없다.

비교 기준(벤치마크)과 유의성 검정
  - 벤치마크: 같은 날 전 종목(같은 유동성 필터)을 시가에 샀을 때의 평균 수익률. 같은 규칙
    (거래정지 이연, 상장폐지 -100%)을 적용한다.
  - 초과수익 = 거래 수익률 - 같은 진입일의 벤치마크 평균. 같은 날 거래들은 서로 상관되어 있으므로
    t값은 진입일별 평균 초과수익을 표본으로 계산한다(날짜 클러스터링).
  - 초과수익 t값 ≥ 2 인 보유일수만 '신호가 벤치마크보다 유의하게 높음'으로 보고, 그 안에서만
    최적 보유일수를 고른다. 하나도 없으면 최적 보유일수를 고르지 않는다.

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
import warnings
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
def trade_matrix(panels, n, delist_return=-1.0):
    """모든 (진입일 e, 종목 k)에 대해 'e 시가 매수 → e+n 종가 매도' 결과를 계산한다.

    반환: R (수익률, 진입 불가·데이터 끝으로 미완료면 NaN), X (실제 청산 행 index), DL (상장폐지 여부)
    """
    o = panels["open"].to_numpy(float)
    c = panels["close"].to_numpy(float)
    r = panels["ret"].to_numpy(float)
    v = panels["value"].to_numpy(float)
    T, K = c.shape
    cols = np.arange(K)

    tradable = (o > 0) & (c > 0) & (v > 0)
    listed = ~np.isnan(c)
    last = np.where(listed.any(0), T - 1 - np.argmax(listed[::-1], axis=0), -1)  # 마지막 상장일
    delisted_stock = last < T - 1  # 기간 끝 전에 사라진 종목 = 상장폐지

    ci = np.cumprod(1 + np.where(tradable, np.nan_to_num(r), 0.0), axis=0)  # 수정주가 누적지수
    # nxt[t,k]: t 이후(포함) 처음 거래 가능한 행, 없으면 T
    nxt = np.full((T + 1, K), T)
    for t in range(T - 1, -1, -1):
        nxt[t] = np.where(tradable[t], t, nxt[t + 1])

    E = np.arange(T)[:, None]
    target = E + n
    x = nxt[np.minimum(target, T - 1), cols]
    done = (target <= T - 1) & (x < T)                  # 청산일(또는 거래재개일) 종가에 매도 완료
    delist = ~done & delisted_stock[None, :] & (E <= last[None, :])  # 매도 전에 상장폐지
    entry = tradable

    xs = np.where(done, x, 0)
    with np.errstate(divide="ignore", invalid="ignore"):
        gross = (c / o) * ci[xs, cols] / ci - 1
    R = np.where(entry & done, gross, np.where(entry & delist, delist_return, np.nan))
    X = np.where(done, x, np.where(delist, last[None, :], -1))
    DL = entry & delist
    return R, X, DL


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


def simulate(sig, R, X, DL):
    """신호일 s → s+1 진입. 종목별로 보유 중(진입일 ≤ 직전 청산일)이면 새 신호는 무시한다."""
    T, K = R.shape
    out = []
    for k in np.flatnonzero(sig.any(0)):
        busy = -1
        for s in np.flatnonzero(sig[:, k]):
            e = s + 1
            if e >= T or e <= busy or np.isnan(R[e, k]):
                continue
            out.append((e, k, R[e, k], X[e, k] - e, DL[e, k]))
            busy = X[e, k]
    return pd.DataFrame(out, columns=["entry", "col", "ret", "days", "delisted"])


def summarize(trades, bench_daily, n, cost):
    if trades.empty:
        return dict(trades=0)
    ret = trades["ret"].to_numpy()
    net = np.maximum(ret - cost, -1.0)
    excess = ret - bench_daily[trades["entry"].to_numpy()]
    by_day = pd.Series(excess).groupby(trades["entry"].to_numpy()).mean()  # 날짜 클러스터링
    t_ex = by_day.mean() / (by_day.std(ddof=1) / np.sqrt(len(by_day))) if len(by_day) > 1 else np.nan
    wins, losses = net[net > 0].sum(), -net[net < 0].sum()
    avg_net = net.mean()
    return {
        "trades": len(ret),
        "delisted": int(trades["delisted"].sum()),
        "win_rate%": (net > 0).mean() * 100,
        "avg%": ret.mean() * 100,
        "avg_net%": avg_net * 100,
        "median_net%": np.median(net) * 100,
        "per_day_net%": avg_net / n * 100,
        "per_day_cagr_net%": ((1 + avg_net) ** (1 / n) - 1) * 100,
        "bench%": np.nanmean(bench_daily[trades["entry"].to_numpy()]) * 100,
        "excess%": np.nanmean(excess) * 100,
        "excess_per_day%": np.nanmean(excess) / n * 100,
        "excess_t": t_ex,
        "profit_factor": wins / losses if losses > 0 else np.inf,
    }


def run_backtest(panels, cost=0.0025, min_value=0.0, streak=3, delist_return=-1.0):
    sigs = {name: m.to_numpy(bool) for name, m in signals(panels, streak, min_value).items()}
    # 벤치마크 모집단: 전날(신호일 역할) 유동성 필터를 통과한 종목
    liquid_prev = np.vstack([np.zeros((1, panels["close"].shape[1]), bool),
                             (panels["value"] >= min_value).to_numpy(bool)[:-1]])
    results = []
    for n in HOLD_DAYS:
        R, X, DL = trade_matrix(panels, n, delist_return)
        with warnings.catch_warnings():  # 전 종목 NaN인 날(기간 끝) 경고 무시
            warnings.simplefilter("ignore", RuntimeWarning)
            bench_daily = np.nanmean(np.where(liquid_prev, R, np.nan), axis=1)
        for name, sig in sigs.items():
            s = summarize(simulate(sig, R, X, DL), bench_daily, n, cost)
            s.update(strategy=name, hold=n)
            results.append(s)
        valid = liquid_prev & ~np.isnan(R)
        bench = pd.DataFrame({"entry": np.nonzero(valid)[0], "ret": R[valid], "delisted": DL[valid]})
        s = summarize(bench, bench_daily, n, cost)
        s.update(strategy="벤치마크(같은 날 전 종목)", hold=n)
        results.append(s)
    cols = ["strategy", "hold", "trades", "delisted", "win_rate%", "avg%", "avg_net%", "median_net%",
            "per_day_net%", "per_day_cagr_net%", "bench%", "excess%", "excess_per_day%", "excess_t",
            "profit_factor"]
    return pd.DataFrame(results)[cols]


def pick_best(res, t_min=2.0):
    """벤치마크보다 유의하게 높은(excess_t ≥ t_min, excess > 0) 보유일수 중에서 최적값을 고른다."""
    lines = []
    for name, g in res[~res.strategy.str.startswith("벤치마크")].groupby("strategy", sort=False):
        sig = g[(g["excess_t"] >= t_min) & (g["excess%"] > 0)]
        lines.append(f"\n[{name}]")
        lines.append(f"  벤치마크 대비 유의하게 높은 보유일수(t≥{t_min}): "
                     f"{', '.join(str(int(h)) + '일' for h in sig.hold) or '없음'}")
        if sig.empty:
            lines.append("  → 신호가 비교 기준보다 유의하게 낫지 않으므로 최적 보유일수를 고르지 않음")
            continue
        b1 = sig.loc[sig["avg_net%"].idxmax()]
        b2 = sig.loc[sig["per_day_net%"].idxmax()]
        lines.append(f"  평균수익률 기준 최적: {int(b1.hold)}일 → 순평균 {b1['avg_net%']:.2f}% "
                     f"(일평균 {b1['per_day_net%']:.3f}%), 초과 {b1['excess%']:.2f}%p, 승률 {b1['win_rate%']:.1f}%")
        lines.append(f"  하루당 수익률 기준 최적: {int(b2.hold)}일 → 일평균 {b2['per_day_net%']:.3f}% "
                     f"(순평균 {b2['avg_net%']:.2f}%), 초과 {b2['excess%']:.2f}%p, 승률 {b2['win_rate%']:.1f}%")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--years", type=float, default=3)
    ap.add_argument("--end", default=None, help="YYYYMMDD (기본: 오늘)")
    ap.add_argument("--cost", type=float, default=0.25, help="왕복 거래비용 %% (수수료+거래세+슬리피지)")
    ap.add_argument("--min-value", type=float, default=1e9, help="신호일 최소 거래대금(원), 저유동성 제외")
    ap.add_argument("--streak", type=int, default=3)
    ap.add_argument("--delist-return", type=float, default=-100, help="보유 중 상장폐지 시 수익률 %%")
    ap.add_argument("--out", default="backtest_result.csv")
    args = ap.parse_args()

    end_dt = datetime.strptime(args.end, "%Y%m%d") if args.end else datetime.today()
    start = (end_dt - timedelta(days=int(365 * args.years) + 10)).strftime("%Y%m%d")
    panels = load_panels(start, end_dt.strftime("%Y%m%d"))

    res = run_backtest(panels, cost=args.cost / 100, min_value=args.min_value, streak=args.streak,
                       delist_return=args.delist_return / 100)
    res.to_csv(args.out, index=False, encoding="utf-8-sig")

    pd.set_option("display.width", 250)
    pd.set_option("display.float_format", "{:.3f}".format)
    for name, g in res.groupby("strategy", sort=False):
        print(f"\n=== {name} ===")
        print(g.drop(columns="strategy").to_string(index=False))

    print("\n=== 보유일수별 평균 vs 하루당 순수익률 (%) ===")
    print(res.pivot(index="hold", columns="strategy", values=["avg_net%", "per_day_net%"])
             .to_string())

    print("\n=== 최적 보유일수 (벤치마크 대비 유의성 확인 후) ===")
    print(pick_best(res))
    print(f"\n결과 저장: {args.out}")


if __name__ == "__main__":
    main()
