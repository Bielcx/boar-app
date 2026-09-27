// findtext <png> <text> [pointWidth]: prints "x,y" (points) of the first OCR line containing text (case-insensitive), else exits 1.
import Foundation
import Vision
import AppKit
let args = CommandLine.arguments
guard args.count >= 3, let img = NSImage(contentsOfFile: args[1]),
      let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(2) }
let target = args[2].lowercased()
let ptW = args.count > 3 ? Double(args[3])! : 375.0
let scale = Double(cg.width) / ptW
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg).perform([req])
for obs in (req.results ?? []) {
  guard let cand = obs.topCandidates(1).first else { continue }
  if cand.string.lowercased().contains(target) {
    let b = obs.boundingBox
    let x = (b.midX * Double(cg.width)) / scale
    let y = ((1 - b.midY) * Double(cg.height)) / scale
    print("\(Int(x)),\(Int(y))"); exit(0)
  }
}
exit(1)
