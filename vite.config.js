import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [tailwindcss()],
  // GitHub Pages serves this as a project site at /portfolio/, not the domain
  // root — every absolute-rooted reference (asset hrefs, in-app navigation)
  // needs this prefix. import.meta.env.BASE_URL exposes it to JS.
  base: '/portfolio/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        rankine: resolve(__dirname, 'src/projects/rankine/index.html'),
        'creatures-menu': resolve(__dirname, 'src/projects/creatures/index.html'),
        'creatures-boids': resolve(__dirname, 'src/projects/creatures/boids.html'),
        'creatures-neural': resolve(__dirname, 'src/projects/creatures/neural.html'),
        'robot-arm': resolve(__dirname, 'src/projects/robot-arm/index.html'),
        pendulum: resolve(__dirname, 'src/projects/pendulum/index.html'),
      },
    },
  },
})
