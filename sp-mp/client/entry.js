// sp-mp 客户端入口：叠加层的 index.html 通过 <script type="module" src="/sp-mp/client/entry.js"> 引入它，
// 它再启动插件本体（client.js）。宿主对插件客户端一无所知 —— 不改宿主的任何文件。
import { start } from './client.js';

if (typeof document === 'undefined') {
  // 不是在浏览器里（例如被工具静态导入）：什么都不做，也不报错
} else {
  try {
    start();
  } catch (e) {
    // 插件坏了也不能拖累宿主：只在自己的控制台前缀里报一声
    console.warn('[sp-mp] client plugin failed to start:', e);
  }
}
