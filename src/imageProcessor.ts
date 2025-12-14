import * as fs from "fs";
import { PNG } from "pngjs";
import * as vscode from "vscode";
import tinycolor = require("tinycolor2");

export interface Color {
    r: number;
    g: number;
    b: number;
    a: number;
}

export interface ProcessingOptions {
    thumbnailSize?: number;
    backgroundColor: Color;
}

// Cache for decoded source images to avoid re-reading/re-decoding the same PNG repeatedly
// Key: Absolute path to image, Value: { mtime: number, png: PNG }
const imageCache = new Map<string, { mtime: number; png: PNG }>();

export class ImageProcessor {
    private outputChannel: vscode.OutputChannel;

    constructor(outputChannel: vscode.OutputChannel) {
        this.outputChannel = outputChannel;
    }

    public async loadPng(absImagePath: string): Promise<PNG> {
        const stats = await fs.promises.stat(absImagePath);
        const cached = imageCache.get(absImagePath);

        if (cached && cached.mtime === stats.mtimeMs) {
            return cached.png;
        }

        this.outputChannel.appendLine(`Parsing PNG at ${absImagePath}`);
        const buffer = await fs.promises.readFile(absImagePath);
        const png = await new Promise<PNG>((resolve, reject) => {
            new PNG().parse(buffer, (error, data) => {
                if (error) reject(error);
                else resolve(data);
            });
        });

        imageCache.set(absImagePath, { mtime: stats.mtimeMs, png });
        return png;
    }

    public generateFrameDataUri(
        sourcePng: PNG,
        rect: { x: number; y: number; w: number; h: number },
        options: ProcessingOptions
    ): vscode.Uri | undefined {
        const { x, y, w, h } = rect;

        if (x + w > sourcePng.width || y + h > sourcePng.height) {
            return undefined;
        }

        const dst = new PNG({ width: w, height: h });
        const { backgroundColor: bgColor } = options;

        // Fill background if not transparent
        if (bgColor.a !== 0) {
            for (let i = 0; i < dst.data.length; i += 4) {
                dst.data[i] = bgColor.r;
                dst.data[i + 1] = bgColor.g;
                dst.data[i + 2] = bgColor.b;
                dst.data[i + 3] = bgColor.a;
            }
        }

        PNG.bitblt(sourcePng, dst, x, y, w, h, 0, 0);
        const dstBuffer = PNG.sync.write(dst);
        const base64 = dstBuffer.toString("base64");
        return vscode.Uri.parse(`data:image/png;base64,${base64}`);
    }

    public static parseColor(str: string): Color {
        const color = tinycolor(str);
        const rgb = color.toRgb();
        return {
            r: rgb.r,
            g: rgb.g,
            b: rgb.b,
            a: Math.round(rgb.a * 255),
        };
    }
}
