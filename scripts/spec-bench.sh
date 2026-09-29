#!/usr/bin/env bash
# Spike 4: n-gram self-speculative decoding vs plain decoding on a RAG prompt.
# Runs on the Mac mini (CPU, 4 threads = phone-like), one server at a time.
# Usage: spec-bench.sh <model.gguf> <label>
set -euo pipefail
MODEL="$1"; LABEL="$2"
BIN="$HOME/boar/spikes/bmoe/third_party/llama.cpp/build-cpu/bin"
OUT="$HOME/boar/spikes/results/spec-$LABEL"
PORT=18099
THREADS="${THREADS:-4}"
NPRED="${NPRED:-256}"
REPS="${REPS:-3}"
mkdir -p "$OUT"

# RAG-shaped prompt: encyclopedia sources + a question whose answer restates them
# (the case prompt-lookup is meant for). Fixed so runs are comparable.
PROMPT_FILE="$OUT/prompt.txt"
cat > "$PROMPT_FILE" <<'EOF'
<|im_start|>system
You are an offline research assistant. Use the sources below when relevant and cite them as [n].

Sources:
[1] Canberra
Canberra is the capital city of Australia. Founded following the federation of the colonies of Australia as the seat of government for the new nation, it is Australia's largest inland city. The site of Canberra was selected for the location of the nation's capital in 1908 as a compromise between Sydney and Melbourne, the two largest cities. The city was designed by the American architects Walter Burley Griffin and Marion Mahony Griffin after an international design contest, and construction commenced in 1913.

[2] Industrial Revolution
The Industrial Revolution was a transition to new manufacturing processes in Great Britain, continental Europe, and the United States, from around 1760 to about 1820 to 1840. This transition included going from hand production methods to machines and new chemical manufacturing processes. The textile industry was the first to use modern production methods, and textiles became the dominant industry in terms of employment and value of output.

[3] French Revolution
The French Revolution was a period of political and societal change in France that began with the Estates General of 1789 and ended with the coup of 18 Brumaire in November 1799. Its causes are generally agreed to be a combination of social, political, and economic factors which the existing regime proved unable to manage. Financial crisis and widespread social distress led to the convocation of the Estates General in May 1789.<|im_end|>
<|im_start|>user
Summarize what the sources say about why Canberra was chosen and designed, then compare the causes of the Industrial Revolution and the French Revolution. Quote the sources where possible.<|im_end|>
<|im_start|>assistant
EOF

run_config() {
  local name="$1"; shift
  "$BIN/llama-server" -m "$MODEL" -t "$THREADS" -c 4096 --port "$PORT" -ngl 0 --no-webui "$@" \
    > "$OUT/server-$name.log" 2>&1 &
  local pid=$!
  for _ in $(seq 1 120); do
    curl -sf "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break
    sleep 1
  done
  for temp in 0 0.7; do
    for rep in $(seq 1 "$REPS"); do
      python3 - "$PROMPT_FILE" "$PORT" "$NPRED" "$temp" "$name" "$rep" >> "$OUT/results.jsonl" <<'PY'
import json, sys, urllib.request
prompt_file, port, npred, temp, name, rep = sys.argv[1:]
body = {"prompt": open(prompt_file).read(), "n_predict": int(npred), "temperature": float(temp),
        "seed": 42 + int(rep), "cache_prompt": False}
req = urllib.request.Request(f"http://127.0.0.1:{port}/completion", data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json"})
r = json.load(urllib.request.urlopen(req, timeout=600))
t = r.get("timings", {})
print(json.dumps({"config": name, "temp": float(temp), "rep": int(rep),
  "predicted_n": t.get("predicted_n"), "predicted_per_second": t.get("predicted_per_second"),
  "prompt_n": t.get("prompt_n"), "prompt_per_second": t.get("prompt_per_second"),
  "draft_n": t.get("draft_n"), "draft_n_accepted": t.get("draft_n_accepted"),
  "text_head": r.get("content", "")[:80]}))
PY
    done
  done
  kill "$pid"; wait "$pid" 2>/dev/null || true
}

run_config none
run_config ngram-simple --spec-type ngram-simple
run_config ngram-mod --spec-type ngram-mod
run_config ngram-map-k --spec-type ngram-map-k

python3 - "$OUT/results.jsonl" <<'PY'
import json, sys, statistics as st
rows = [json.loads(l) for l in open(sys.argv[1])]
base = {}
for temp in (0.0, 0.7):
    b = [r["predicted_per_second"] for r in rows if r["config"] == "none" and r["temp"] == temp]
    base[temp] = st.median(b) if b else None
print(f"{'config':14} {'temp':>4} {'tok/s med':>9} {'vs none':>8} {'accept':>7}")
for cfg in ("none", "ngram-simple", "ngram-mod", "ngram-map-k"):
    for temp in (0.0, 0.7):
        rs = [r for r in rows if r["config"] == cfg and r["temp"] == temp]
        if not rs: continue
        tps = st.median(r["predicted_per_second"] for r in rs)
        dn = sum(r.get("draft_n") or 0 for r in rs); da = sum(r.get("draft_n_accepted") or 0 for r in rs)
        acc = f"{da/dn:.0%}" if dn else "-"
        rel = f"{tps/base[temp]:.2f}x" if base.get(temp) else "-"
        print(f"{cfg:14} {temp:>4} {tps:>9.1f} {rel:>8} {acc:>7}")
PY
