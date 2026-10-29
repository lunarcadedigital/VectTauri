<p align="center">
  <img src="assets/20260514_163417_vecttauri.jpg" alt="VectTauri — Event-Based AI Memory for TauriTavern" width="100%" />
</p>

# VectTauri — Advanced RAG for TauriTavern

> **Fork of [VectFox](https://github.com/KritBlade/VectFox)** by Kritblade — all VectFox credits belong to the original author. VectTauri adapts it for **TauriTavern** (Android).

VectTauri brings full RAG (Retrieval-Augmented Generation) memory to TauriTavern. Unlike the original VectFox, which needs the Similharity plugin inside SillyTavern's Node.js backend, VectTauri ships with a **built-in Similharity layer** that runs entirely on-device — no server, no Termux, no network setup required.

## ✨ Highlights

- **Zero setup** — install the extension and it works. Vectors are stored on-device through TauriTavern's native vector engine (Rust + redb + on-device embeddings)
- **Rich RAG metadata** — importance weighting, keywords, conditional activation, chunk groups, temporal data: everything the VectFox engine expects, preserved intact
- **Event-Based memory** — LLM-driven event extraction keeps meaningful story moments, not just recent messages
- **Optional Qdrant** — power users can run Qdrant in Termux for very large collections

---

## 📋 Requirements

- **TauriTavern** (Android/desktop) — [Download](https://github.com/Darkatse/TauriTavern)

That's it. No Termux, Node.js, or Qdrant needed for the default built-in mode.

---

## 🚀 Installation

1. Open **TauriTavern**
2. Go to **Extensions** panel (puzzle piece icon)
3. Click **"Install Extension"**
4. Paste this URL:
   ```
   https://github.com/lunarcadedigital/VectTauri
   ```
5. Click **Install** and open **VectTauri Settings**

The **Similharity Mode** defaults to **Auto**: inside TauriTavern it uses the built-in on-device engine automatically. You can change it under **VectTauri Settings → Similharity Mode**:

| Mode | What it does | Best for |
|------|--------------|----------|
| **Auto** (default) | Built-in inside TauriTavern, native plugin on desktop SillyTavern | Everyone |
| **Built-in** | Vectors via TauriTavern's native on-device vector API; rich metadata in the TT store. No server, no network. | Most users |

### Getting started with Built-in mode

1. Open a chat and open **VectTauri → Vectorization**
2. Click **"Vectorize Content"** to index the conversation
3. Retrieval starts injecting relevant memories into your prompts automatically
4. Use the **Database Browser** and **Chunk Visualizer** tabs to inspect what's stored

---

## 🗄️ Advanced: Qdrant in Termux (optional, for large collections)

For very large collections (tens of thousands of chunks), you can run **Qdrant** — a fast vector database — directly in Termux on the same phone.

### 1. Install Qdrant in Termux

```bash
# Update Termux packages
pkg update -y

# Download Qdrant (ARM64 build for Android/Termux)
cd ~
curl -sL "https://github.com/qdrant/qdrant/releases/download/v1.20.0/qdrant-aarch64-unknown-linux-musl.tar.gz" -o qdrant.tar.gz

# Extract and install
tar xzf qdrant.tar.gz
mv qdrant ~/.local/bin/qdrant
chmod +x ~/.local/bin/qdrant
```

> If `~/.local/bin` doesn't exist: `mkdir -p ~/.local/bin` first. Make sure it is in your `PATH` (Termux usually includes it; otherwise add `export PATH="$HOME/.local/bin:$PATH"` to `~/.bashrc`).

### 2. Configure Qdrant (allow requests from TauriTavern)

Qdrant needs CORS enabled so the TauriTavern WebView can talk to it. Create `~/qdrant_config.yaml`:

```yaml
service:
  host: 127.0.0.1
  port: 6333
  # Allow the WebView origin to call the REST API
  cors_origin: "*"
storage:
  storage_path: ~/qdrant_storage
```

### 3. Start Qdrant

```bash
qdrant --config-path ~/qdrant_config.yaml
```

You should see Qdrant listening on `http://127.0.0.1:6333`.

### 4. Auto-start helper (optional)

Create `~/rp` for easy start/stop:

```bash
#!/data/data/com.termux/files/usr/bin/bash
case "${1:-start}" in
    start)
        pgrep -f "qdrant" > /dev/null || qdrant --config-path ~/qdrant_config.yaml > /dev/null 2>&1 &
        echo "✅ Qdrant started"
        ;;
    stop)
        pkill -f "qdrant"
        echo "🛑 Qdrant stopped"
        ;;
    status)
        echo "Qdrant:  $(pgrep -f 'qdrant' > /dev/null && echo '🟢' || echo '🔴')"
        ;;
esac
```

```bash
chmod +x ~/rp
rp start    # Start Qdrant
rp stop     # Stop Qdrant
rp status   # Check status
```

> Keep Termux alive: use **acquire wakelock** (`termux-wake-lock`) or disable battery optimization for Termux, so Android doesn't kill it in the background.

### 5. Notes

- Qdrant over plain HTTP (`http://127.0.0.1:6333`) requires a TauriTavern build with cleartext traffic enabled (`configure-mobile-http.sh enable android` in the TauriTavern repo). Debug builds allow it by default.
- On-device loopback between apps works on most Android ROMs; if requests are refused, bind Qdrant to `0.0.0.0` and use your phone's LAN IP instead.

---

## 🔄 Updating

Update the extension from **Extensions panel → Check for Updates**, or reinstall from the URL above.

---

## 📄 License

MIT License — Based on [VectFox](https://github.com/KritBlade/VectFox) by Kritblade (GPLv3).

---

## 🙏 Credits

- **[KritBlade](https://github.com/KritBlade)** — Original VectFox & Similharity plugin
- **[Darkatse](https://github.com/Darkatse)** — TauriTavern
- **Lunarcade Digital** — TauriTavern adaptation

---

## Contributors

| Name | Division | Role |
|------|----------|------|
| Fajar Nugroho | Qa | Quality assurance & testing |
| Ayu Pratiwi | Web | Web development |
| Agus Pratama | Asset | 2D assets & visuals |
| Dewi Lestari | Architect | System architecture |
| Nina Salsabila | Research | Tech research & analysis |
| Ahmad Fauzi | Release | Release & CI pipeline |
| Gilang Permadi | Web | Web integration & optimization |
| Raka Wiraguna | Design | UI/UX design |
| Sari Dewi | Archive | Documentation & archival |
| Dimas Pratama | Fixing | Bug fixes & patching |
