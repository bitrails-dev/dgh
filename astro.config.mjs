import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';
import tailwind from '@astrojs/tailwind';
import astroI18next from 'astro-i18next';
import sitemap from '@astrojs/sitemap';

const site = process.env.PUBLIC_SITE ?? 'https://vm.garsony.xyz';
const base = process.env.PUBLIC_BASE ?? '';
console.log(site, base);

export default defineConfig({
	site,
	base,
	output: 'static',
	i18n: {
		defaultLocale: 'ar',
		locales: ['ar', 'en'],
		routing: {
			prefixDefaultLocale: false,
		},
	},
	server: {
		host: true,
		port: parseInt(process.env.PORT ?? '4321'),
	},
	vite: {
		optimizeDeps: {
			force: true,
		},
		server: {
			hmr: { protocol: 'ws' },
		},
	},
	integrations: [
		sitemap({
			i18n: {
				defaultLocale: 'ar',
				locales: {
					ar: 'ar-EG',
					en: 'en-US',
				},
			},
		}),
		vue(), // no appEntrypoint — avoids virtual:astro:vue-app resolution issue
		tailwind({ applyBaseStyles: false }),
		astroI18next(),
	],
});
