import Foundation
import Vision
import AppKit
let a = CommandLine.arguments
guard let img = NSImage(contentsOfFile: a[1]), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(2) }
let s = Double(cg.width) / 375.0
let r = VNRecognizeTextRequest(); r.recognitionLevel = .accurate; r.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([r])
for o in r.results ?? [] { if let c = o.topCandidates(1).first { let b = o.boundingBox; print("\(Int(b.midX*Double(cg.width)/s)),\(Int((1-b.midY)*Double(cg.height)/s)) \(c.string)") } }
