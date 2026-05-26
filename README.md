# danmaku

这是一个基于 Cloudflare Workers 和 R2 的 [dandanplay API](https://api.dandanplay.net/swagger/index.html) 代理 Worker。

## 项目结构

- `src/index.js`：Worker 入口文件
- `wrangler.jsonc`：Worker 与 R2 绑定配置

## 功能说明

- 仅代理白名单内的 API 请求
- 使用 Cloudflare Cache API 作为一级缓存
- 使用 R2 作为弹幕接口的二级缓存
- 基于请求指纹实现风险控制与限流
