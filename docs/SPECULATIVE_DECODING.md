# Speculative and n-gram decoding in llama.rn — spike

TL;DR
- **In the app today, only MTP speculative decoding can run.** llama.rn 0.13.0-rc.4 vendors a llama.cpp that has every speculative type (`ngram-simple`, `ngram-map-k`, `ngram-map-k4v`, `ngram-mod`, `ngram-cache`, `draft-simple`, `draft-eagle3`, `draft-mtp`, ...), and its JSI layer passes any `spec_type` name through. But llama.rn's own completion loop only drives speculation when the type is `draft-mtp` (`shouldUseMTP()` in `cpp/rn-completion.cpp`). Every other type is parsed and then ignored.
- **Prompt-lookup / n-gram decoding needs a native patch** to llama.rn (relax `shouldUseMTP` to the n-gram types and skip the MTP draft-context setup, since n-gram needs no draft model). Effort M, plus a native rebuild by the device lab.
- **MTP is not available on the deep model we have.** `Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf` has no `nextn_predict_layers` key and no extra block after `blk.39` (40 layers), so its MTP head was stripped in this quant.
- **On the MoE deep tier, speculation probably hurts.** BigMoeOnEdge measured -18% to -29% on a phone with expert streaming for both n-gram and MTP: verifying a batch of drafted tokens touches the union of their experts in every layer (Caldera, `spikes/bmoe/docs/ngram.md`, `mtp.md`).
- **Measured on the dense 1.5B (desktop CPU proxy): n-gram gives 1.6× with greedy decoding but only ~1.06× at the app's temperature 0.7**, because acceptance drops from 66–80% to 23–27% once tokens are sampled. Not worth a native patch at today's sampling settings.

## Support matrix

| Method | llama.cpp (vendored) | llama.rn runtime | Needs | Fits our models |
|---|---|---|---|---|
| n-gram self-speculative (`ngram-*`) | yes | **no** (ignored) | patch `rn-completion.cpp` | any model; best when the answer restates the sources (RAG) |
| Prompt-lookup (`llama-lookup` example) | example program only | no | same patch, `ngram-cache` type | same |
| Draft model (`draft-simple`) | yes | no | patch + a second small model resident (RAM) | Qwen2.5-0.5B → 1.5B/7B |
| MTP (`draft-mtp`) | yes | **yes** (`speculative: { type: "mtp", n_max }`) | GGUF with MTP layers | not the UD-Q2_K_XL Qwen3.6 we have |
| EAGLE3 / DFlash | yes | no | patch + trained head | none we ship |

Evidence: `node_modules/llama.rn/vendor/llama.cpp/common/speculative.cpp:34-44` (type names), `node_modules/llama.rn/cpp/jsi/JSIParams.cpp:132-245` (pass-through parsing), `node_modules/llama.rn/cpp/rn-completion.cpp:640-700` (`shouldUseMTP`, `initMTP`).

## Results (Mac mini M4, CPU, 4 threads, RAG prompt)

Script: `~/boar/spikes/spec-bench.sh` on the Mac mini (copy in this PR under `scripts/spec-bench.sh`). llama-server from the llama.cpp build at `~/boar/spikes/bmoe/third_party/llama.cpp` (0e8c83e), `-ngl 0 -t 4 -c 4096`, 256 predicted tokens, 3 repetitions per config, median tok/s.

Model: Qwen2.5-1.5B-Instruct Q4_K_M. Prompt: ~600 tokens of encyclopedia sources plus a summarize-and-compare question (`scripts/spec-bench.sh`). Run 2026-09-26 16:34 via the mini's heavy-job queue, nothing else running.

| Config | temp 0: tok/s | vs none | draft acceptance | temp 0.7: tok/s | vs none | draft acceptance |
|---|---|---|---|---|---|---|
| none | 36.8 | 1.00× | – | 32.8 | 1.00× | – |
| ngram-simple | 43.5 | 1.18× | 58% | 34.9 | 1.06× | 23% |
| ngram-mod | 58.9 | 1.60× | 66% | 34.9 | 1.06× | 27% |
| ngram-map-k | 59.9 | 1.63× | 80% | 31.0 | 0.94× | 23% |

Raw rows: `~/boar/spikes/results/spec-qwen15/results.jsonl` on the Mac mini.

## Recommendation

Decision rule set before the run: patch llama.rn for `ngram-*` only if the dense fast model gains ≥ 1.3× at temperature 0.7 (the app's default). It gains 1.06×, so **no patch now**.

- **Option (not decided):** grounded answers could use a low temperature (0–0.3), where n-gram gives ~1.6×. That trades answer diversity for speed and needs the frontier evaluation to show quality does not drop; only then is the native patch (`rn-completion.cpp`: accept `ngram-mod`/`ngram-map-k` in the speculative path without an MTP draft context) worth doing.
- **Deep tier:** keep speculation off (MoE expert streaming loses 18–29% per BigMoeOnEdge's phone measurements).
- **MTP:** revisit only with a Qwen3.6 quant that keeps the `nextn` layer and fits 12 GB.

## UNKNOWN

- Phone numbers: the desktop CPU run (M4) is a proxy; ARM phone cores and memory bandwidth differ. Acceptance rate (the part that transfers) is reported separately from tok/s for that reason.
- Whether a Qwen3.6-35B-A3B quant that keeps the MTP layer fits the 12 GB budget.
- The header check for MTP layers is a string scan of the first 30 MB of the GGUF (tensor names and keys), not a full parse.
