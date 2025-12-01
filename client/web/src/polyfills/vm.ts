// Minimal vm polyfill for browser builds.
// asn1.js tries to use vm.runInThisContext for naming constructors but
// gracefully falls back when vm is unavailable. We mirror that fallback here.
export function runInThisContext(_code: string) {
  return function namedEntity(this: any, entity: unknown) {
    // Preserve asn1.js behavior by delegating to the injected initializer.
    if (typeof this?._initNamed === "function") {
      this._initNamed(entity);
    }
  };
}

export default { runInThisContext };
