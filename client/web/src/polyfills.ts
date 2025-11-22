// Minimal polyfills for Vite + Solana
import { Buffer } from "buffer";
import process from "process";

declare global {
  interface Window { Buffer?: any; global?: any; process?: any; }
}
if (!window.Buffer) window.Buffer = Buffer;
if (!(window as any).global) (window as any).global = window;
if (!window.process) window.process = process as any;
