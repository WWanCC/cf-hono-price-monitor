/**
 * 前端启动入口：注册 Element Plus 和全局样式，然后把根组件挂载到 index.html 的 #app。
 */
import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
createApp(App).use(ElementPlus).mount('#app')
