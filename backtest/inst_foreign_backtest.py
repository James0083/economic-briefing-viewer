"""
기관 3일 연속 순매수 종목 백테스트 (+ 외국인 동시 순매수 조건)

전략
  - 신호일 D: 기관합계 순매수대금이 D-2, D-1, D 3거래일 연속 > 0
  - 조건 B(외국인 동반): 위 조건 + 같은 3일 동안 외국인 순매수대금도 연속 > 0
  - 진입: D+1 시가 매수 (4일, 5일… 연속 순매수가 이어져도 추가 매수하지 않음)
  - 청산: 순매수가 끝난 시점부터 N거래일 보유 후 종가 매도 (N = 1..10)
      연속 순매수 마지막 날을 L 이라 하면 L+1 이 '순매수가 끊긴 날'(장 마감 후 확인)이고
      L+1+N 종가에 매도한다.
      예) 3일(D-2~D)만 순매수 → L=D, N=1 이면 D+2 종가 매도
          5일(D-2~D+2) 순매수 → L=D+2, N=1 이면 D+4 종가 매도
  - 청산 후 새로운 연속 순매수 신호가 나면 다시 진입한다. 보유 중 끊겼다가 다시 시작된
    연속 순매수는 무시하고 정해진 청산일을 유지한다.
  - 기간 끝까지 순매수가 끝나지 않은(청산일을 정할 수 없는) 거래는 제외한다.
  - 청산일이 거래정지면 거래가 재개되는 첫날 종가에 매도한다.
  - 보유 중 상장폐지(이후 데이터에서 종목이 사라짐)되면 수익률 -100%로 처리한다.
  - 수익률은 KRX 등락률(권리락·액면분할 반영)을 체인해서 계산하므로 분할로 인한 왜곡이 없다.

비교 기준(벤치마크)과 유의성 검정
  - 벤치마크: 각 거래와 같은 날 매수·같은 날 매도했을 때 전 종목(같은 유동성 필터)의 평균
    수익률. 같은 규칙(거래정지 이연, 상장폐지 -100%)을 적용한다.
  - 초과수익 = 거래 수익률 - 해당 거래의 벤치마크. 같은 날 거래들은 서로 상관되어 있으므로
    t값은 진입일별 평균 초과수익을 표본으로 계산한다(날짜 클러스터링).
  - 하루당 수익률은 실제 보유 거래일수(매수일 포함, 매도일까지) 평균으로 나눈 값이다.
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
class Market:
    """패널을 numpy 배열로 바꾸고, (매수일, 목표 매도일) → 수익률 계산에 필요한 값을 미리 만든다."""

    def __init__(self, panels, delist_return=-1.0):
        o = panels["open"].to_numpy(float)
        c = panels["close"].to_numpy(float)
        r = panels["ret"].to_numpy(float)
        v = panels["value"].to_numpy(float)
        T, K = c.shape
        self.T, self.K, self.delist_return = T, K, delist_return

        self.tradable = (o > 0) & (c > 0) & (v > 0)
        listed = ~np.isnan(c)
        self.last = np.where(listed.any(0), T - 1 - np.argmax(listed[::-1], axis=0), -1)  # 마지막 상장일
        self.delisted = self.last < T - 1  # 기간 끝 전에 사라진 종목 = 상장폐지
        self.ci = np.cumprod(1 + np.where(self.tradable, np.nan_to_num(r), 0.0), axis=0)  # 수정주가 누적지수
        with np.errstate(divide="ignore", invalid="ignore"):
            self.intraday = np.where(self.tradable, c / o, np.nan)  # 매수일 시가→종가
        # nxt[t,k]: t 이후(포함) 처음 거래 가능한 행, 없으면 T
        nxt = np.full((T + 1, K), T)
        for t in range(T - 1, -1, -1):
            nxt[t] = np.where(self.tradable[t], t, nxt[t + 1])
        self.nxt = nxt

    def result(self, e, target, cols=None):
        """e 시가 매수 → target 종가 매도를 cols 종목(기본: 전 종목)에 대해 계산.
        (수익률, 실제 매도 행, 상장폐지 여부)

        target 이 거래정지면 재개 첫날 종가에 매도, 그 전에 상장폐지면 delist_return,
        데이터가 끝나 결과를 알 수 없거나 e 에 매수할 수 없으면 NaN.
        """
        T = self.T
        cols = np.arange(self.K) if cols is None else np.atleast_1d(cols)
        x = self.nxt[target, cols] if target <= T - 1 else np.full(len(cols), T)
        done = x < T
        last = self.last[cols]
        delist = ~done & self.delisted[cols] & (e <= last)
        xs = np.where(done, x, e)
        ret = self.intraday[e, cols] * self.ci[xs, cols] / self.ci[e, cols] - 1
        entry = self.tradable[e, cols]
        R = np.where(entry & done, ret, np.where(entry & delist, self.delist_return, np.nan))
        X = np.where(done, x, np.where(delist, last, -1))
        return R, X, entry & delist


def streak_end(cond):
    """end[t,k]: t 에서 시작해 cond 가 이어지는 마지막 행. 기간 끝까지 이어지면 -1."""
    T, K = cond.shape
    end = np.full((T, K), -1)  # 마지막 날까지 이어지면 끝났는지 알 수 없으므로 -1
    for t in range(T - 2, -1, -1):
        end[t] = np.where(cond[t] & ~cond[t + 1], t, np.where(cond[t], end[t + 1], -1))
    return end


def signals(panels, streak=3, min_value=0.0):
    """{전략명: (진입 신호, 연속 순매수 여부)}. 연속 여부는 순매수가 끝나는 시점을 찾는 데 쓴다."""
    inst = panels["inst"].reindex_like(panels["close"]) > 0
    frgn = panels["frgn"].reindex_like(panels["close"]) > 0
    liquid = panels["value"] >= min_value
    out = {}
    for name, cond in (("A. 기관 3일 연속", inst), ("B. 기관+외국인 3일 연속", inst & frgn)):
        ok = cond.astype(int).rolling(streak).sum() == streak
        out[name] = ((ok & liquid).to_numpy(bool), cond.to_numpy(bool))
    return out


def plan_trades(sig, cond):
    """종목별로 (후보 매수 행 e, 그 연속 순매수의 마지막 날 L) 목록을 만든다.

    보유 중 여부는 이전 거래의 매도일(N 에 따라 다름)에 달려 있으므로 simulate 에서 판단한다.
    """
    end = streak_end(cond)
    plans = []
    for k in np.flatnonzero(sig.any(0)):
        rows = np.flatnonzero(sig[:, k])
        plans.append((k, rows + 1, end[rows, k]))
    return plans


def simulate(plans, mkt, n, liquid_prev):
    """보유기간 N 에 대한 거래와 각 거래의 벤치마크(같은 매수·매도일 전 종목 평균)를 계산한다."""
    cache = {}

    def bench(e, target):
        if (e, target) not in cache:
            R = mkt.result(e, target, np.flatnonzero(liquid_prev[e]))[0]
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)
                cache[(e, target)] = np.nanmean(R)
        return cache[(e, target)]

    out = []
    for k, entries, ends in plans:
        busy = -1
        for e, last in zip(entries, ends):
            if e >= mkt.T or e <= busy:
                continue  # 이미 보유 중이면 추가 매수하지 않음
            if last < 0:
                break     # 기간 끝까지 순매수가 이어져 매도일을 정할 수 없음
            target = last + 1 + n
            (r,), (x,), (dl,) = mkt.result(e, target, k)
            if np.isnan(r):
                continue
            out.append((e, k, r, x - e + 1, dl, bench(e, target)))
            busy = x
    return pd.DataFrame(out, columns=["entry", "col", "ret", "days", "delisted", "bench"])


def summarize(trades, cost):
    if trades.empty:
        return dict(trades=0)
    ret = trades["ret"].to_numpy()
    net = np.maximum(ret - cost, -1.0)
    excess = ret - trades["bench"].to_numpy()
    by_day = pd.Series(excess).groupby(trades["entry"].to_numpy()).mean()  # 날짜 클러스터링
    t_ex = by_day.mean() / (by_day.std(ddof=1) / np.sqrt(len(by_day))) if len(by_day) > 1 else np.nan
    wins, losses = net[net > 0].sum(), -net[net < 0].sum()
    avg_net, days = net.mean(), trades["days"].mean()
    return {
        "trades": len(ret),
        "delisted": int(trades["delisted"].sum()),
        "avg_days": days,
        "win_rate%": (net > 0).mean() * 100,
        "avg%": ret.mean() * 100,
        "avg_net%": avg_net * 100,
        "median_net%": np.median(net) * 100,
        "per_day_net%": avg_net / days * 100,
        "per_day_cagr_net%": ((1 + avg_net) ** (1 / days) - 1) * 100,
        "bench%": trades["bench"].mean() * 100,
        "excess%": excess.mean() * 100,
        "excess_per_day%": excess.mean() / days * 100,
        "excess_t": t_ex,
        "profit_factor": wins / losses if losses > 0 else np.inf,
    }


def run_backtest(panels, cost=0.0025, min_value=0.0, streak=3, delist_return=-1.0):
    mkt = Market(panels, delist_return)
    # 벤치마크 모집단: 매수 전날(신호일 역할) 유동성 필터를 통과한 종목
    liquid_prev = np.vstack([np.zeros((1, mkt.K), bool),
                             (panels["value"] >= min_value).to_numpy(bool)[:-1]])
    plans = {name: plan_trades(sig, cond) for name, (sig, cond) in signals(panels, streak, min_value).items()}
    results = []
    for n in HOLD_DAYS:
        for name, p in plans.items():
            s = summarize(simulate(p, mkt, n, liquid_prev), cost)
            s.update(strategy=name, hold=n)
            results.append(s)
    cols = ["strategy", "hold", "trades", "delisted", "avg_days", "win_rate%", "avg%", "avg_net%",
            "median_net%", "per_day_net%", "per_day_cagr_net%", "bench%", "excess%", "excess_per_day%",
            "excess_t", "profit_factor"]
    return pd.DataFrame(results)[cols]


def pick_best(res, t_min=2.0):
    """벤치마크보다 유의하게 높은(excess_t ≥ t_min, excess > 0) 보유일수 중에서 최적값을 고른다."""
    lines = []
    for name, g in res.groupby("strategy", sort=False):
        sig = g[(g["excess_t"] >= t_min) & (g["excess%"] > 0)]
        lines.append(f"\n[{name}]")
        lines.append(f"  벤치마크 대비 유의하게 높은 N(순매수 종료 후 보유일, t≥{t_min}): "
                     f"{', '.join(str(int(h)) + '일' for h in sig.hold) or '없음'}")
        if sig.empty:
            lines.append("  → 신호가 비교 기준보다 유의하게 낫지 않으므로 최적 보유일수를 고르지 않음")
            continue
        for label, col in (("평균수익률", "avg_net%"), ("하루당 수익률", "per_day_net%")):
            b = sig.loc[sig[col].idxmax()]
            lines.append(f"  {label} 기준 최적: 순매수 종료 후 {int(b.hold)}일 보유 "
                         f"(실제 평균 보유 {b['avg_days']:.1f}거래일) → 순평균 {b['avg_net%']:.2f}%, "
                         f"일평균 {b['per_day_net%']:.3f}%, 초과 {b['excess%']:.2f}%p, 승률 {b['win_rate%']:.1f}%")
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

    print("\n=== 순매수 종료 후 보유일(N)별 평균 vs 하루당 순수익률 (%) ===")
    print(res.pivot(index="hold", columns="strategy", values=["avg_days", "avg_net%", "per_day_net%", "excess_t"])
             .to_string())

    print("\n=== 최적 보유일수 (벤치마크 대비 유의성 확인 후) ===")
    print(pick_best(res))
    print(f"\n결과 저장: {args.out}")


if __name__ == "__main__":
    main()
