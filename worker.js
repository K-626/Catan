export class GameRoom {
    constructor(state, env) {
        this.state = state;
        this.gameState = null; // キャッシュ用
        this.seats = null;     // { [clientId]: seatIndex }
    }

    async fetch(request) {
        const upgradeHeader = request.headers.get("Upgrade");
        if (upgradeHeader !== "websocket") {
            return new Response("Expected Upgrade: websocket", { status: 426 });
        }

        const url = new URL(request.url);
        const clientId = url.searchParams.get("client") || ("anon-" + Math.random().toString(36).slice(2, 9));

        const pair = new WebSocketPair();
        const client = pair[0];
        const server = pair[1];

        this.state.acceptWebSocket(server, [clientId]);

        // storageから復元
        if (!this.gameState) {
            this.gameState = await this.state.storage.get("gameState");
        }
        if (!this.seats) {
            this.seats = (await this.state.storage.get("seats")) || {};
        }

        // 席の自動割り当て
        let seat = this.seats[clientId];
        if (seat === undefined) {
            const maxPlayers = this.gameState ? this.gameState.n : 4;
            const takenSeats = new Set(Object.values(this.seats));
            let assignedSeat = -1;
            for (let i = 0; i < maxPlayers; i++) {
                if (!takenSeats.has(i)) {
                    assignedSeat = i;
                    break;
                }
            }
            this.seats[clientId] = assignedSeat;
            await this.state.storage.put("seats", this.seats);
            seat = assignedSeat;
        }

        // 初期情報（割り当てられた席と現在のゲーム状態）を送信
        server.send(JSON.stringify({
            type: "welcome",
            seat: seat,
            state: this.gameState
        }));

        return new Response(null, {
            status: 101,
            webSocket: client,
        });
    }

    async webSocketMessage(ws, msg_str) {
        try {
            const data = JSON.parse(msg_str);

            if (data.type === "init") {
                // 新規ゲーム作成時：作成者を席0にし、席マップを初期化
                if (data.clientId) {
                    this.seats = { [data.clientId]: 0 };
                    await this.state.storage.put("seats", this.seats);
                    ws.send(JSON.stringify({ type: "welcome", seat: 0, state: data.state }));
                }
                if (data.state) {
                    this.gameState = data.state;
                    await this.state.storage.put("gameState", this.gameState);
                }
                // 送信元を除く全員にブロードキャスト
                for (const sock of this.state.getWebSockets()) {
                    if (sock !== ws) {
                        sock.send(JSON.stringify({ state: this.gameState }));
                    }
                }
            } else if (data.type === "action") {
                if (data.state) {
                    this.gameState = data.state;
                    await this.state.storage.put("gameState", this.gameState);
                }
                for (const sock of this.state.getWebSockets()) {
                    if (sock !== ws) {
                        sock.send(JSON.stringify({ state: this.gameState }));
                    }
                }
            } else if (data.type === "get") {
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
        // ライブラリ側で管理
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
