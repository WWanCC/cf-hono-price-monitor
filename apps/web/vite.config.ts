/** Vite 开发配置：Vue 插件负责 SFC 编译，/api 请求代理到本地 Hono Worker。 */
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue()],
    // 浏览器只访问 Vite 端口；以 /api 开头的请求转发给 Hono，免去本地跨域配置。
    server: {
      proxy: {
        '/api': {
          target: env.VITE_DEV_API_TARGET || 'http://127.0.0.1:9029',
          changeOrigin: true,
        },
      },
    },
  }
})
