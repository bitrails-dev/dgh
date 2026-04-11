import { defineStore } from "pinia";

export const useUiStore = defineStore("ui", {
  state: () => ({
    mobileMenuOpen: false,
  }),
  actions: {
    toggleMenu() {
      this.mobileMenuOpen = !this.mobileMenuOpen;
    },
    closeMenu() {
      this.mobileMenuOpen = false;
    },
  },
});
