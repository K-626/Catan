export class GameRoom {
  constructor(state, env) {
    this.state = state;
    this.gameState = null; // キャッシュ用（永続化はstorageで行う）
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    this.state.acceptWebSocket(server);

    // ハイバネーション後もstorageから復元する
    const saved = await this.state.storage.get("gameState");
    if (saved) {
      this.gameState = saved;
      server.send(JSON.stringify({ state: this.gameState }));
    }

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws, msg_str) {
    try {
      const data = JSON.parse(msg_str);

      if (data.type === "init" || data.type === "action") {
        if (data.state) {
          this.gameState = data.state;
          // Durable Object Storageに永続化（ハイバネーション対策）
          await this.state.storage.put("gameState", this.gameState);
        }

        // 送信元を除く全員にブロードキャスト
        for (const sock of this.state.getWebSockets()) {
          if (sock !== ws) {
            sock.send(JSON.stringify({ state: this.gameState }));
          }
        }
      } else if (data.type === "get") {
        // storageから最新状態を取得して返す
        const saved = this.gameState ?? (await this.state.storage.get("gameState"));
        if (saved) {
          this.gameState = saved;
          ws.send(JSON.stringify({ state: saved }));
        }
      }
    } catch (err) {
      ws.send(JSON.stringify({ error: err.message }));
    }
  }

  webSocketError(ws, error) {
    console.error("WebSocket error:", error);
    ws.close(1011, "WebSocket error");
  }

  webSocketClose(ws, code, reason, wasClean) {
    // 明示的にcloseしない（ライブラリ側で処理済み）
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const roomName = url.searchParams.get("room") || "default-room";

    const id = env.GAME_ROOM.idFromName(roomName);
    const stub = env.GAME_ROOM.get(id);

    return stub.fetch(request);
  },
};

