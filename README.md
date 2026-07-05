# QIX — 陣取りバトル

スマホで遊べる QIX 風の陣取りアクションゲーム。**1人でも、最大4人のオンライン対戦でも**遊べます。
外周から線を引いて領域を囲み、囲んだ陣地を自分の色に。動き回る敵 **QIX** に線を引いている最中に
触れられるとミス。Web / PWA なのでインストール不要、スマホのブラウザでそのまま遊べます。

## 遊び方

- 画面下の **十字ボタン**（PC は矢印キー / WASD）でマーカーを動かします。
- 自陣・外周の上は自由に移動でき、**未確保エリアに入ると線を引き始めます**。
- 線が自陣／外周に戻ると閉じたエリアが確定し、**敵がいない側**が自分の陣地になります。
- **敵 QIX が線に触れるとミス**（ソロ＝ライフ減、対戦＝その場でやり直し）。
- **ソロ**: 目標 75% を確保すればクリア。ライフが尽きるとゲームオーバー。
- **対戦（最大4人）**: 制限時間内で確保率を競います。ホストがルームを作り、コードを共有して参加。

## 構成

npm workspaces のモノレポ。ゲームロジックはクライアント／サーバーで共有します。

```
shared/   決定論的なグリッド QIX エンジン（型・グリッド・シミュレーション）
client/   Vite + TypeScript + Canvas の PWA
server/   Node + ws。対戦の権威シミュレーション。本番はビルド済みクライアントも配信
```

- **ソロ**はクライアント単体でエンジンを回すためオフラインでも動作（Service Worker）。
- **対戦**はサーバーが 30Hz で権威シミュレーションを実行し、状態スナップショットと確保差分を配信。
  同一の `shared/` エンジンを使うためロジックが二重化しません。

## 開発

必要環境: Node 22+

```bash
npm install
npm run dev
```

- クライアント: http://localhost:5173 （Vite。`/ws` は :8787 のサーバーへプロキシ）
- サーバー: http://localhost:8787

同一 LAN のスマホから試すには、`http://<PCのIP>:5173` を開いてください（Vite は `host: true` で LAN 公開）。
2 台以上でルームを作成・参加すれば対戦できます。

### テストと検証

```bash
npm run typecheck   # 全 TypeScript の型チェック
npm test            # エンジンの単体テスト（vitest）
npm run smoke       # 本番ビルドを Chromium で E2E スモーク（ソロ＋2人対戦）
npm run verify      # 上記すべて
```

## 本番ビルド / ローカル本番起動

```bash
npm run build       # client を静的ビルド + server をバンドル
npm start           # node server/dist/index.js（静的配信 + /ws を同一ポートで提供）
# PORT で待受ポートを変更可: PORT=8080 npm start
```

## クラウドデプロイ

1 サービス（静的配信 + WebSocket を同一ポート）で完結します。ヘルスチェックは `/healthz`。

### Docker

```bash
docker build -t qix .
docker run -p 8080:8080 qix   # http://localhost:8080
```

### Render / Railway / Fly.io

- **Render**: 同梱の `render.yaml`（Docker ランタイム）をそのまま利用できます。GitHub に push し、
  Blueprint からデプロイ。`PORT` は自動で渡されます。
- **Railway / Fly.io**: Dockerfile をそのまま使えます。`PORT` 環境変数を待受に使用します。

> WebSocket を使うため、リバースプロキシ / ホストの設定で `/ws` の Upgrade（ws/wss）が
> 通ることを確認してください（Render・Railway・Fly はデフォルトで対応）。

## GitHub Pages で公開（＋ Render で対戦サーバー）

GitHub Pages は**静的配信のみ**で WebSocket サーバーを動かせないため、二段構成にします。

- **クライアント（PWA）→ GitHub Pages**: ソロは完全に動作。公開 URL は
  `https://<user>.github.io/<repo>/`（例: `https://ishikawa1982.github.io/qix/`）。
- **対戦サーバー（ws）→ Render**: 上記「Render / Docker」でデプロイ。Pages のクライアントは
  ビルド時に埋め込む `VITE_WS_URL` で Render の `/ws` に接続します。

### 手順

1. **対戦サーバーを Render にデプロイ**（同梱 `render.yaml` / `Dockerfile`）。払い出された URL を控える
   （例 `https://qix.onrender.com`）。対戦用の WebSocket URL は `wss://qix.onrender.com/ws`。
2. **GitHub リポジトリ設定**:
   - `Settings → Pages → Build and deployment → Source = GitHub Actions`。
   - `Settings → Secrets and variables → Actions → Variables` に
     **リポジトリ変数 `VITE_WS_URL`** を追加し、値を `wss://<app>.onrender.com/ws` に設定。
3. **デプロイ**: 既定ブランチ（`main`）へ push すると `.github/workflows/deploy-pages.yml` が
   クライアントをサブパス（`/<repo>/`）向けにビルドして Pages に公開します。
   手動実行は `Actions → Deploy client to GitHub Pages → Run workflow`。

補足:
- Pages は HTTPS のため、対戦サーバーは **`wss://`（TLS）** が必須です（`ws://` は mixed content で拒否）。
- `VITE_WS_URL` 未設定でもビルドは通り**ソロは動作**します（対戦は接続失敗トーストになります）。
- Render を使わず**1 サービス構成**（サーバーがクライアントも配信）にする場合は上記「Docker / Render」
  だけで完結し、`VITE_WS_URL` は不要です（同一オリジンの `/ws` に接続）。

### ローカル検証（Pages + Render 相当）

```bash
npm run smoke:pages   # client をサブパス /qix/ でビルド→vite preview 配信、
                      # 別オリジンの ws サーバーへ接続してソロ＋2人対戦を E2E 検証
```

## MVP の範囲と今後

実装済み: ソロ（敵・ライフ・勝敗）、最大4人オンライン対戦（ルーム／権威ループ／確保同期）、PWA、
Docker、GitHub Pages 自動デプロイ（＋ Render 対戦サーバー）。

今後の拡張（stretch）:

- 対人 trail 切り（相手の線を切って落とす PvP 要素）
- Sparx（外周を巡回する敵）、スロー/ファスト描画による小領域ボーナス
- クライアント予測・補間の強化、再接続、観戦モード、ソロの AI 対戦相手
