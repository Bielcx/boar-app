import { describe, it, expect } from "vitest";
import { modelErrorKind, modelErrorPrimary, showsRawError } from "./modelError";

// What reaches JS on the iPhone 13 (Harbor: llama.rn RNLlamaJSI.cpp:715), then native lines from
// builds/ios/device-console-90b87dd.log and Tusk's CPU-fallback reason (6fa0ba3).
const METAL = [
  "Failed to load model",
  "failed to initialize MTL0 backend",
  "llama_init_from_model: failed to initialize the context: failed to initialize MTL0 backend",
  "ggml_backend_metal_device_init_backend: error: failed to allocate context",
  "ggml_metal_init: error: failed to initialize the Metal library",
  'Compilation failed due to an interrupted connection: XPC_ERROR_CONNECTION_INTERRUPTED.',
  "unable to initialize context for model: /var/mobile/Containers/Data/Application/X/Documents/models/qwen2.5-1.5b-instruct-q4km.gguf",
];

describe("modelErrorKind", () => {
  it("reads engine/backend start failures as 'engine', not memory (iPhone 13 Metal failure)", () => {
    for (const line of METAL) expect(modelErrorKind(line)).toBe("engine");
  });

  it("reads file problems first", () => {
    expect(modelErrorKind("size mismatch: expected 1000 got 900")).toBe("corrupt");
    expect(modelErrorKind("sha256 hash differs")).toBe("corrupt");
    expect(modelErrorKind("ENOENT: no such file or directory")).toBe("missing");
    expect(modelErrorKind("model file not found")).toBe("missing");
    expect(modelErrorKind("Model not found at /data/models/x.gguf. Run the setup wizard to install it first.")).toBe("missing");
  });

  it("sends Android's llama.cpp context failure to engine; its hint also suggests a smaller model", () => {
    expect(modelErrorKind("failed to allocate buffer / failed to create context")).toBe("engine");
  });

  it("reads memory from explicit out-of-memory text, and from 'allocate' only outside the engine", () => {
    expect(modelErrorKind("OOM while creating context")).toBe("memory");
    expect(modelErrorKind("Out of memory")).toBe("memory");
    expect(modelErrorKind("Failed to allocate 2.1 GB")).toBe("memory");
  });

  it("falls back to general, without taking words that merely contain 'ram' or 'oom'", () => {
    expect(modelErrorKind("init failed")).toBe("general");
    expect(modelErrorKind("")).toBe("general");
    expect(modelErrorKind("bad parameter in program")).toBe("general");
    expect(modelErrorKind("room for improvement")).toBe("general");
  });
});

describe("modelErrorPrimary", () => {
  it("offers setup only when the file is missing or damaged", () => {
    expect(modelErrorPrimary("missing")).toBe("setup");
    expect(modelErrorPrimary("corrupt")).toBe("setup");
  });

  it("leads with retry for engine, memory and unknown failures (the Metal case never goes back to setup)", () => {
    expect(modelErrorPrimary(modelErrorKind(METAL[0]))).toBe("retry");
    expect(modelErrorPrimary("engine")).toBe("retry");
    expect(modelErrorPrimary("memory")).toBe("retry");
    expect(modelErrorPrimary("general")).toBe("retry");
  });
});

describe("showsRawError", () => {
  it("shows the engine's own words for engine and unknown failures only", () => {
    expect(showsRawError("engine")).toBe(true);
    expect(showsRawError("general")).toBe(true);
    expect(showsRawError("memory")).toBe(false);
    expect(showsRawError("missing")).toBe(false);
  });
});
