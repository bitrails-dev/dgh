import { reactive } from "vue";

// Module-level singleton
const state = reactive({ mobileMenuOpen: false });

// Drop-in replacement for the old Pinia store — same property/method names
export function useUiStore() {
  return {
    get mobileMenuOpen() { return state.mobileMenuOpen; },
    toggleMenu() { state.mobileMenuOpen = !state.mobileMenuOpen; },
    closeMenu()  { state.mobileMenuOpen = false; },
  };
}
