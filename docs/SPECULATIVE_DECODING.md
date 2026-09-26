# Speculative and n-gram decoding in llama.rn — spike

TL;DR
- **In the app today, only MTP speculative decoding can run.** llama.rn 0.13.0-rc.4 vendors a llama.cpp that has every speculative type (`ngram-simple`, `ngram-map-k`, `ngram-map-k4v`, `ngram-mod`, `ngram-cache`, `draft-simple`, `draft-eagle3`, `draft-mtp`, ...), and its JSI layer passes any `spec_type` name through. But llama.rn's own completion loop only drives speculation when the type is `draft-mtp` (`shouldUseMTP()` in `cpp/rn-completion.cpp`). Every other type is parsed and then ignored.
- **Prompt-lookup / n-gram decoding needs a native patch** to llama.rn (relax `shouldUseMTP` to the n-gram types and skip the MTP draft-context setup, since n-gram needs no draft model). Effort M, plus a native rebuild by the device lab.
- **MTP is not available on the deep model we have.** `Qwen3.6-35B-A3B-UD-Q2_K_XL.gguf` has no `nextn_predict_layers` key and no extra block after `blk.39` (40 layers), so its MTP head was stripped in this quant.
- **On the MoE deep tier, speculation probably hurts.** BigMoeOnEdge measured -18% to -29% on a phone with expert streaming for both n-gram and MTP: verifying a batch of drafted tokens touches the union of their experts in every layer (Caldera, `spikes/bmoe/docs/ngram.md`, `mtp.md`).
- Desktop numbers for the dense 1.5B (the case where it should pay off): see Results.

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

PENDING — filled in after the run (the mini is shared; one heavy job at a time).

## Recommendation

PENDING the numbers. Decision rule: patch llama.rn for `ngram-*` only if the dense fast model gains ≥ 1.3× decode speed at temperature 0.7 (the app's default) on the RAG prompt; keep speculation off for the MoE deep tier.

## UNKNOWN

- Phone numbers: the desktop CPU run is a proxy; ARM phone cores and memory bandwidth differ. Acceptance rate (the part that transfers) is reported separately from tok/s for that reason.
- Whether a Qwen3.6-35B-A3B quant that keeps the MTP layer fits the 12 GB budget.
- The header check for MTP layers is a string scan of the first 30 MB of the GGUF (tensor names and keys), not a full parse.
