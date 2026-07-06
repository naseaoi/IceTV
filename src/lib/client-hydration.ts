let clientHydrated = false;

export function markClientHydrated() {
  clientHydrated = true;
}

export function isClientHydrated() {
  return clientHydrated;
}
