# 🦊 VectTauri — Advanced RAG for TauriTavern

> **Fork of [VectFox](https://github.com/KritBlade/VectFox)** by Kritblade, modified for **TauriTavern** (Android) with **external Similharity bridge** support.

VectTauri brings full RAG (Retrieval-Augmented Generation) memory to TauriTavern using an external Similharity server running on Termux. Unlike the original VectFox which requires the Similharity plugin inside SillyTavern's Node.js backend, VectTauri connects to an **external HTTPS bridge** — making it work on TauriTavern which doesn't have a Node.js server.

---

## 🎯 What's Different from VectFox?

| Feature | VectFox (original) | VectTauri (this fork) |
|---------|-------------------|----------------------|
| Platform | SillyTavern (desktop) | **TauriTavern (Android)** |
| Similharity plugin | Inside SillyTavern | **External bridge server (Termux)** |
| Bridge URL | Hardcoded relative path | **Configurable in Settings** |
| Backend | Qdrant / Standard | Qdrant / Standard |

---

## 📋 Requirements

- **TauriTavern** (Android app) — [Download](https://github.com/Darkatse/TauriTavern)
- **Termux** (Android terminal) — [F-Droid](https://f-droid.org/packages/com.termux/)
- **Node.js** in Termux
- **Qdrant** in Termux (optional, for A3 hybrid search)

---

## 🚀 Installation

### Step 1: Install VectTauri Extension in TauriTavern

1. Open **TauriTavern**
2. Go to **Extensions** panel (puzzle piece icon)
3. Click **"Install Extension"**
4. Paste this URL:
   ```
   https://github.com/lunarcadedigital/VectFox
   ```
5. Click **Install**

### Step 2: Setup Similharity Bridge on Termux

This is the key difference from original VectFox — the Similharity plugin runs as an **external HTTPS server** on Termux.

#### 2a. Install Dependencies

```bash
# Install Node.js (if not installed)
pkg update && pkg install nodejs-lts -y

# Install OpenSSL (for SSL certificates)
pkg install openssl -y
```

#### 2b. Clone & Setup Bridge

```bash
# Create bridge directory
mkdir -p ~/tauritavern-bridge && cd ~/tauritavern-bridge

# Initialize and install Express
npm init -y
npm install express node-forge

# Clone Similharity plugin
git clone -b Similharity-Plugin https://github.com/KritBlade/VectFox.git similharity
cd similharity && npm install && cd ..
```

#### 2c. Generate SSL Certificate

```bash
# Generate self-signed certificate
node -e "
import('node-forge').then(({default: forge}) => {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notAfter.getFullYear() + 1);
  const attrs = [{ name: 'commonName', value: 'localhost' }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([{
    name: 'subjectAltName',
    altNames: [
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      { type: 7, ip: '10.0.2.2' },
    ]
  }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  require('fs').writeFileSync('cert.pem', forge.pki.certificateToPem(cert));
  require('fs').writeFileSync('key.pem', forge.pki.privateKeyToPem(keys.privateKey));
  console.log('Certificate generated!');
});
" --input-type=module
```

#### 2d. Create Bridge Server

Create `server.js`:

```javascript
import express from 'express';
import https from 'https';
import fs from 'fs';
import { init as initSimilharity, info } from './similharity/index.js';

const app = express();
const PORT = process.env.PORT || 8443;

app.use(express.json({ limit: '50mb' }));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', plugin: info?.name, version: info?.version });
});

const router = express.Router();
await initSimilharity(router);
console.log(`[Bridge] Similharity loaded: ${info?.name} v${info?.version}`);

app.use('/api/plugins/similharity', router);
app.use('/api/plugins/similarity', router);

const sslKey = fs.readFileSync('key.pem');
const sslCert = fs.readFileSync('cert.pem');

https.createServer({ key: sslKey, cert: sslCert }, app).listen(PORT, '0.0.0.0', () => {
    console.log(`[Bridge] ✅ Running on https://0.0.0.0:${PORT}`);
});
```

Set `type: "module"` in `package.json`:
```bash
python3 -c "import json; d=json.load(open('package.json')); d['type']='module'; json.dump(d, open('package.json','w'), indent=2)"
```

#### 2e. Start the Bridge

```bash
node server.js
```

You should see:
```
[Bridge] Similharity loaded: Similharity v3.3.4
[Bridge] ✅ Running on https://0.0.0.0:8443
```

#### 2f. Get Your IP Address

```bash
# Get your Termux IP (WiFi)
ifconfig wlan0 | grep inet
# or
hostname -I
```

Note the IP address (e.g., `192.168.1.100`). You'll need this for the next step.

### Step 3: Install Ollama (Embedding)

```bash
# Install Ollama from Termux repo
pkg install ollama -y

# Start Ollama
ollama serve &

# Pull embedding model
ollama pull embeddinggemma-2:270m
```

### Step 4: Install Qdrant (Optional, for A3 Search)

```bash
# Download Qdrant
cd ~
curl -sL "https://github.com/qdrant/qdrant/releases/download/v1.20.0/qdrant-aarch64-unknown-linux-musl.tar.gz" -o qdrant.tar.gz
tar xzf qdrant.tar.gz
mv qdrant ~/.local/bin/qdrant
chmod +x ~/.local/bin/qdrant

# Start Qdrant
qdrant &
```

### Step 5: Configure VectTauri in TauriTavern

1. Open **TauriTavern** → **Extensions** → **VectTauri**
2. Go to **Core** tab
3. Find **"Similharity Bridge URL"** field
4. Enter your bridge URL: `https://<YOUR_IP>:8443` (e.g., `https://192.168.1.100:8443`)
5. Select your **Embedding Provider** → **Ollama**
6. Set Ollama URL: `http://<YOUR_IP>:11434`
7. Set Ollama Model: `embeddinggemma-2:270m`
8. Click **"Vectorize Content"** to start indexing

---

## 📁 Quick Start Script

Create `~/rp` for easy service management:

```bash
#!/data/data/com.termux/files/usr/bin/bash
case "${1:-start}" in
    start)
        pgrep -f "ollama serve" > /dev/null || ollama serve > /dev/null 2>&1 &
        pgrep -f "qdrant" > /dev/null || qdrant > /dev/null 2>&1 &
        pgrep -f "node server.js" > /dev/null || (cd ~/tauritavern-bridge && node server.js > /dev/null 2>&1 &)
        echo "✅ All services started"
        ;;
    stop)
        pkill -f "ollama serve"
        pkill -f "qdrant"
        pkill -f "node server.js"
        echo "🛑 All services stopped"
        ;;
    status)
        echo "Ollama:  $(pgrep -f 'ollama serve' > /dev/null && echo '🟢' || echo '🔴')"
        echo "Qdrant:  $(pgrep -f 'qdrant' > /dev/null && echo '🟢' || echo '🔴')"
        echo "Bridge:  $(pgrep -f 'node server.js' > /dev/null && echo '🟢' || echo '🔴')"
        ;;
esac
```

```bash
chmod +x ~/rp
rp start    # Start all services
rp stop     # Stop all services
rp status   # Check status
```

---

## ⚠️ Important Notes

- **Bridge must be running** before using VectTauri in TauriTavern
- **Self-signed certificate** — TauriTavern may show a security warning. Accept it.
- **Same WiFi network** — TauriTavern and Termux must be on the same network
- **IP changes** — If your phone's IP changes, update the Bridge URL in settings
- **Keep services running** — Use Termux's `fg` or a wake-lock to prevent Android from killing Termux

---

## 🔄 Updating

```bash
# Update bridge
cd ~/tauritavern-bridge
git pull
npm install

# Update VectTauri in TauriTavern
# Extensions panel → Check for Updates
```

---

## 📄 License

MIT License — Based on [VectFox](https://github.com/KritBlade/VectFox) by Kritblade (GPLv3).

---

## 🙏 Credits

- **[KritBlade](https://github.com/KritBlade)** — Original VectFox & Similharity plugin
- **[Darkatse](https://github.com/Darkatse)** — TauriTavern
- **Lunarcade Digital** — TauriTavern adaptation
