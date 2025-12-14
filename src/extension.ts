import * as path from "path";
import * as vscode from "vscode";
import { ImageProcessor, ProcessingOptions } from "./imageProcessor";
import { parseSpriteSheet } from "./parser";

let outputChannel: vscode.OutputChannel;
let imageProcessor: ImageProcessor;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel("Sprite Preview");
    outputChannel.appendLine("Sprite Preview extension is active");

    imageProcessor = new ImageProcessor(outputChannel);

    // Cache to hold decoration types and options per document
    const decorationCache = new Map<
        string,
        { type: vscode.TextEditorDecorationType; options: vscode.DecorationOptions }[]
    >();

    let timeout: NodeJS.Timeout | undefined = undefined;
    let activeEditor = vscode.window.activeTextEditor;

    if (activeEditor) {
        triggerUpdateDecorations();
    }

    // Helper to dispose decorations for a specific file
    function disposeDecorations(fileName: string) {
        const cached = decorationCache.get(fileName);
        if (cached) {
            cached.forEach((item) => item.type.dispose());
            decorationCache.delete(fileName);
        }
    }

    vscode.window.onDidChangeActiveTextEditor(
        (editor) => {
            activeEditor = editor;
            if (editor) {
                // Try to restore from cache immediately
                if (decorationCache.has(editor.document.fileName)) {
                    outputChannel.appendLine(
                        `Restoring cached decorations for ${editor.document.fileName}`
                    );
                    const cached = decorationCache.get(editor.document.fileName)!;
                    cached.forEach((item) => {
                        editor.setDecorations(item.type, [item.options]);
                    });
                } else {
                    triggerUpdateDecorations();
                }
            }
        },
        null,
        context.subscriptions
    );

    vscode.workspace.onDidChangeTextDocument(
        (event) => {
            if (activeEditor && event.document === activeEditor.document) {
                // Invalidate cache on change
                disposeDecorations(event.document.fileName);
                triggerUpdateDecorations();
            }
        },
        null,
        context.subscriptions
    );

    vscode.workspace.onDidChangeConfiguration((e) => {
        if (
            e.affectsConfiguration("spritePreview.thumbnailSize") ||
            e.affectsConfiguration("spritePreview.backgroundColor")
        ) {
            // Clear all caches
            for (const key of decorationCache.keys()) {
                disposeDecorations(key);
            }
            triggerUpdateDecorations();
        }
    });

    function triggerUpdateDecorations() {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        timeout = setTimeout(updateDecorations, 500);
    }

    async function updateDecorations() {
        if (!activeEditor) {
            return;
        }

        const doc = activeEditor.document;
        if (doc.languageId !== "json") {
            return;
        }

        // Parse the document
        const spriteData = parseSpriteSheet(doc);
        if (!spriteData) {
            return;
        }

        const { imagePath, frames } = spriteData;
        const jsonDir = path.dirname(doc.fileName);
        const absImagePath = path.join(jsonDir, imagePath);

        // Load the source image
        let sourcePng;
        try {
            sourcePng = await imageProcessor.loadPng(absImagePath);
        } catch (e) {
            outputChannel.appendLine(`Failed to load PNG: ${e}`);
            return;
        }

        // Get Configuration
        const config = vscode.workspace.getConfiguration("spritePreview");
        const size = config.get<number | undefined>("thumbnailSize");
        const backgroundColorStr = config.get<string>("backgroundColor") || "transparent";
        const bgColor = ImageProcessor.parseColor(backgroundColorStr);
        const processingOptions: ProcessingOptions = {
            thumbnailSize: size,
            backgroundColor: bgColor,
        };

        disposeDecorations(doc.fileName);

        const newDecorations: {
            type: vscode.TextEditorDecorationType;
            options: vscode.DecorationOptions;
        }[] = [];

        if (activeEditor.document !== doc) return;

        outputChannel.appendLine(`Processing ${frames.length} frames...`);

        const CHUNK_SIZE = 10;
        let processed = 0;

        for (const frame of frames) {
            if (activeEditor.document !== doc) {
                newDecorations.forEach((d) => d.type.dispose());
                return;
            }

            try {
                const dataUri = imageProcessor.generateFrameDataUri(
                    sourcePng,
                    frame.rect,
                    processingOptions
                );

                if (dataUri) {
                    const imgTag = size
                        ? `<img src="${dataUri.toString(true)}" height="${size}" style="image-rendering: pixelated;" />`
                        : `<img src="${dataUri.toString(true)}" style="image-rendering: pixelated;" />`;

                    const markdown = new vscode.MarkdownString(
                        `**${frame.key}** (${frame.rect.w}x${frame.rect.h})  \n${imgTag}`
                    );
                    markdown.isTrusted = true;
                    markdown.supportHtml = true;

                    const frameDecorationType = vscode.window.createTextEditorDecorationType({
                        gutterIconPath: dataUri,
                        gutterIconSize: "contain",
                    });

                    const decorationOptions: vscode.DecorationOptions = {
                        range: frame.range,
                        hoverMessage: markdown,
                    };

                    if (activeEditor && activeEditor.document === doc) {
                        activeEditor.setDecorations(frameDecorationType, [decorationOptions]);
                    }

                    newDecorations.push({ type: frameDecorationType, options: decorationOptions });
                }
            } catch (err) {
                outputChannel.appendLine(`Error processing frame ${frame.key}: ${err}`);
            }

            processed++;
            if (processed % CHUNK_SIZE === 0) {
                await new Promise((r) => setTimeout(r, 0));
            }
        }

        outputChannel.appendLine(`Setting ${newDecorations.length} decorations.`);
        decorationCache.set(doc.fileName, newDecorations);
    }
}

export function deactivate() {
    if (outputChannel) {
        outputChannel.dispose();
    }
}