import Foundation
import Vision
import AppKit

// Usage: ocr <image1> [image2 ...]   -> prints recognized text per image, page-separated on stderr markers
let args = Array(CommandLine.arguments.dropFirst())
guard !args.isEmpty else { FileHandle.standardError.write("no images\n".data(using:.utf8)!); exit(2) }

for path in args {
    guard let img = NSImage(contentsOfFile: path),
          let tiff = img.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let cg = bitmap.cgImage else {
        FileHandle.standardError.write("FAILED-LOAD \(path)\n".data(using:.utf8)!)
        print("")
        continue
    }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = true
    req.recognitionLanguages = ["en-US","pt-PT"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    do {
        try handler.perform([req])
        let obs = req.results ?? []
        var lines: [String] = []
        for o in obs {
            if let top = o.topCandidates(1).first { lines.append(top.string) }
        }
        print(lines.joined(separator: "\n"))
    } catch {
        FileHandle.standardError.write("FAILED-OCR \(path): \(error)\n".data(using:.utf8)!)
        print("")
    }
    print("\u{0C}") // form-feed page separator
}
