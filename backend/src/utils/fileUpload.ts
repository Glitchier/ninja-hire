import type { Request } from "express";
import busboy from "busboy";

export interface ParsedFileUpload {
  fileBuffer: Buffer;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

/**
 * Wraps Busboy event callbacks into a manual Promise without using util.promisify!
 */
export function parseMultipartUpload(
  req: Request,
  maxBytes: number = 5 * 1024 * 1024,
): Promise<ParsedFileUpload> {
  return new Promise((resolve, reject) => {
    // 1. Initialize Busboy with header & size limits
    const bb = busboy({
      headers: req.headers,
      limits: { fileSize: maxBytes, files: 1 },
    });

    const fileChunks: Buffer[] = [];
    let fileMeta: { name: string; mimeType: string } | null = null;
    let sizeExceeded = false;

    // 2. Listen to the 'file' event
    bb.on("file", (fieldname, fileStream, info) => {
      const { filename, mimeType } = info;

      // Validate allowed mime types (PDF and DOCX)
      const allowedMimes = [
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/msword",
      ];

      if (!allowedMimes.includes(mimeType)) {
        fileStream.resume(); // Discard stream
        return reject(
          new Error("Invalid file type. Only PDF and DOCX files are allowed."),
        );
      }

      fileMeta = { name: filename || "Unknown File", mimeType };

      // Stream data chunks into memory buffer
      fileStream.on("data", (chunk: Buffer) => {
        fileChunks.push(chunk);
      });

      // Handle file limit exceeded
      fileStream.on("limit", () => {
        sizeExceeded = true;
        fileStream.resume();
      });

      // 🚨 ERROR PATH: Listen to file stream errors!
      fileStream.on("error", (err: Error) => {
        reject(err);
      });
    });

    // 3. 🚨 ERROR PATH: Listen to Busboy parser errors!
    bb.on("error", (err: Error) => {
      reject(err);
    });

    // 4. Listen to the 'close' event when parsing finishes
    bb.on("close", () => {
      if (sizeExceeded) {
        return reject(new Error("File size exceeds the 5MB limit."));
      }

      if (!fileMeta || fileChunks.length === 0) {
        return reject(
          new Error("No resume file was attached to the application."),
        );
      }

      const fileBuffer = Buffer.concat(fileChunks);
      resolve({
        fileBuffer,
        fileName: fileMeta.name,
        mimeType: fileMeta.mimeType,
        fileSize: fileBuffer.length,
      });
    });

    // Pipe the raw incoming HTTP request stream into Busboy
    req.pipe(bb);
  });
}
