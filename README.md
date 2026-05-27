# danmaku

这是一个基于 Cloudflare Workers 和 R2 的 [dandanplay API](https://api.dandanplay.net/swagger/index.html) 代理服务。

## 项目结构

- `src/index.js`：Worker 入口文件
- `wrangler.jsonc`：Worker 配置文件

## 功能说明

- 仅代理白名单内的 dandanplay API 请求
- 使用 Cache API 作为所有接口的一级缓存
- 使用 Cloudflare R2 作为弹幕接口的二级缓存
- 基于请求指纹实现简单的风险控制与限流

## 开源协议

本项目基于 [MIT](LICENSE) 开源协议发布。
