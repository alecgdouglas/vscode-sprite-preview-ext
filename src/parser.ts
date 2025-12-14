import * as jsonc from "jsonc-parser";
import * as path from "path";
import * as vscode from "vscode";

export interface SpriteFrameRect {
    x: number;
    y: number;
    w: number;
    h: number;
}

export interface SpriteFrame {
    key: string;
    range: vscode.Range;
    rect: SpriteFrameRect;
}

export interface SpriteSheetData {
    imagePath: string;
    frames: SpriteFrame[];
}

export function parseSpriteSheet(document: vscode.TextDocument): SpriteSheetData | undefined {
    const text = document.getText();
    
    // Quick check before heavy parsing
    if (!text.includes('"frames"') || !text.includes('"meta"')) {
        return undefined;
    }

    const tree = jsonc.parseTree(text);
    if (!tree) return undefined;

    const framesNode = jsonc.findNodeAtLocation(tree, ["frames"]);
    const metaNode = jsonc.findNodeAtLocation(tree, ["meta"]);

    if (!framesNode || !metaNode) {
        return undefined;
    }

    const imageNode = jsonc.findNodeAtLocation(metaNode, ["image"]);
    if (!imageNode || imageNode.type !== "string") {
        return undefined;
    }

    const imagePath = imageNode.value;
    const frames: SpriteFrame[] = [];

    if (framesNode.type === "object" && framesNode.children) {
        for (const propNode of framesNode.children) {
            const keyNode = propNode.children![0];
            const valueNode = propNode.children![1];
            const key = keyNode.value;

            const startPos = document.positionAt(keyNode.offset);
            const endPos = document.positionAt(keyNode.offset + keyNode.length);
            const range = new vscode.Range(startPos, endPos);

            const rect = extractFrameRect(valueNode);
            if (rect) {
                frames.push({ key, range, rect });
            }
        }
    } else if (framesNode.type === "array" && framesNode.children) {
        for (const itemNode of framesNode.children) {
            if (itemNode.type !== "object") continue;

            const filenameValueNode = jsonc.findNodeAtLocation(itemNode, ["filename"]);
            if (!filenameValueNode || filenameValueNode.type !== "string") continue;

            const key = filenameValueNode.value;

            // Find the property node for "filename" to get the key range
            const filenamePropNode = filenameValueNode.parent;
            if (
                !filenamePropNode ||
                filenamePropNode.type !== "property" ||
                !filenamePropNode.children
            )
                continue;

            const filenameKeyNode = filenamePropNode.children[0];
            const startPos = document.positionAt(filenameKeyNode.offset);
            const endPos = document.positionAt(filenameKeyNode.offset + filenameKeyNode.length);
            const range = new vscode.Range(startPos, endPos);

            const rect = extractFrameRect(itemNode);
            if (rect) {
                frames.push({ key, range, rect });
            }
        }
    }

    return { imagePath, frames };
}

function extractFrameRect(node: jsonc.Node): SpriteFrameRect | undefined {
    // Expecting structure: { "frame": { "x": ..., "y": ..., "w": ..., "h": ... } }
    const rectNode = jsonc.findNodeAtLocation(node, ["frame"]);
    if (!rectNode) return undefined;

    const xNode = jsonc.findNodeAtLocation(rectNode, ["x"]);
    const yNode = jsonc.findNodeAtLocation(rectNode, ["y"]);
    const wNode = jsonc.findNodeAtLocation(rectNode, ["w"]);
    const hNode = jsonc.findNodeAtLocation(rectNode, ["h"]);

    if (!xNode || !yNode || !wNode || !hNode) return undefined;

    const x = xNode.value;
    const y = yNode.value;
    const w = wNode.value;
    const h = hNode.value;

    if (
        typeof x !== "number" ||
        typeof y !== "number" ||
        typeof w !== "number" ||
        typeof h !== "number"
    )
        return undefined;

    if (w <= 0 || h <= 0) return undefined;

    return { x, y, w, h };
}
