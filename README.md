<div align="center">

<img src="icons/icon128.png" alt="LeetSync Logo" width="100" />

# ⚡ LeetSync

### *Automatically push your LeetCode accepted solutions to GitHub — hands-free.*

[![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=for-the-badge&logo=google-chrome&logoColor=white&labelColor=1a1a2e)](https://github.com)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-00b8a3?style=for-the-badge&labelColor=1a1a2e)](https://developer.chrome.com/docs/extensions/mv3/)
[![GitHub API](https://img.shields.io/badge/GitHub-API%20v3-6c5ce7?style=for-the-badge&logo=github&labelColor=1a1a2e)](https://docs.github.com/en/rest)
[![Made By](https://img.shields.io/badge/Made%20by-Devesh%20Samant-ffa116?style=for-the-badge&labelColor=1a1a2e)](https://deveshsamant.in/)

---

**Solve it. Submit it. It's on GitHub. That's it.** ✨

</div>

---

## 🎯 What is LeetSync?

LeetSync is a Chrome extension that watches for your LeetCode submissions in the background. The moment your solution is **Accepted**, it automatically:

- 📥 Captures your code and the full problem description
- 📂 Organizes it into a clean folder structure in your GitHub repo
- 📝 Generates a beautiful README with stats, badges, and difficulty tracking
- 📊 Maintains a live dashboard of all your solved problems

**Zero clicks. Zero copy-paste. Just solve and submit.**

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🤖 **Fully Automatic** | Detects accepted submissions with zero user interaction |
| 📋 **Full Problem Data** | Saves the complete problem description, examples & constraints |
| 🏷️ **Rich Metadata** | Difficulty, topic tags, runtime, memory beats % |
| 📊 **Live Dashboard** | Auto-updated README with progress bars and language stats |
| 🌍 **15+ Languages** | Python, Java, C++, Go, Rust, JS, TS, and more |
| 🔒 **Private & Secure** | Your token is stored locally in Chrome's sync storage |
| 🔄 **Smart Updates** | Re-submissions update the existing file, no duplicates |

---

## 📁 Generated Repo Structure

```
your-repo/
├── README.md                              ← 📊 Auto-generated dashboard
└── problems/
    ├── 0001-Two-Sum/
    │   ├── README.md                      ← Full problem + stats badges
    │   └── solution.java
    ├── 0015-3Sum/
    │   ├── README.md
    │   └── solution.cpp
    └── 0121-Best-Time-to-Buy-and-Sell-Stock/
        ├── README.md
        └── solution.py
```

---

## 🚀 Installation

> **No Chrome Web Store needed** — load it directly in 3 steps.

**Step 1** — Clone or download this repo:
```bash
git clone https://github.com/Deveshsamant/LeetSync.git
```

**Step 2** — Load in Chrome:
1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select the `LeetSync` folder

**Step 3** — Configure:
1. Click the **LeetSync** icon in your toolbar
2. Paste your **GitHub Personal Access Token** ([create one here](https://github.com/settings/tokens/new?scopes=repo&description=LeetSync) — needs `repo` scope)
3. Enter your repo in `owner/repo` format (e.g. `Deveshsamant/LeetCode_DSA`)
4. Click **Save Settings** → **Verify**

✅ You're done. Go solve problems!

---

## 🔄 How It Works

```
User clicks Submit on LeetCode
        │
        ▼
injected.js intercepts fetch() in MAIN world
        │
        ▼ (postMessage)
content.js polls submission result
        │
        ▼ status_msg === "Accepted"
Fetches problem details via LeetCode GraphQL API
        │
        ▼
background.js pushes to GitHub:
  ├── problems/{id}-{title}/README.md   (problem description + badges)
  ├── problems/{id}-{title}/solution.xx (your code with header comment)
  └── README.md                         (updated dashboard)
        │
        ▼
✅ Toast notification on LeetCode page
```

---

## 📸 Preview

**Extension Popup**

> Dark-themed popup with GitHub connection status, token management, and live push statistics.

**Generated Problem README** — example badges:

![Difficulty](https://img.shields.io/badge/Difficulty-Easy-00b8a3?style=for-the-badge&labelColor=1a1a2e)
![Language](https://img.shields.io/badge/Language-Java-6c5ce7?style=for-the-badge&labelColor=1a1a2e)
![Date](https://img.shields.io/badge/Date-2026--06--23-0984e3?style=for-the-badge&labelColor=1a1a2e)

**Generated Root README** — live progress dashboard:
```
  Total Solved      1  █
  
  🟢 Easy           1  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 100%
  🟡 Medium         0  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0%
  🔴 Hard           0  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ 0%
```

---

## 🛠️ Supported Languages

| Language | Extension | Language | Extension |
|----------|-----------|----------|-----------|
| Python / Python3 | `.py` | JavaScript | `.js` |
| Java | `.java` | TypeScript | `.ts` |
| C++ | `.cpp` | Go | `.go` |
| C | `.c` | Rust | `.rs` |
| C# | `.cs` | Swift | `.swift` |
| Kotlin | `.kt` | Ruby | `.rb` |
| Scala | `.scala` | PHP | `.php` |
| Dart | `.dart` | SQL (all variants) | `.sql` |

---

## 🔐 Privacy & Security

- Your GitHub token is stored **only in Chrome's local sync storage**
- No data is sent anywhere except directly to the **GitHub API**
- No analytics, no tracking, no third-party servers
- Open source — inspect every line of code

---

## 📦 File Structure

```
LeetSync/
├── manifest.json       ← Chrome Manifest V3
├── injected.js         ← MAIN world fetch interceptor
├── content.js          ← ISOLATED world — handles scraping & push trigger
├── background.js       ← Service worker — GitHub API calls
├── utils.js            ← Shared utilities (HTML→MD, language map)
├── popup.html          ← Extension popup UI
├── popup.css           ← Premium dark theme styles
├── popup.js            ← Popup logic
├── toast.css           ← On-page toast notifications
└── icons/              ← Extension icons (16, 48, 128px)
```

---

## 🤝 Contributing

Pull requests are welcome! If LeetCode updates their UI and breaks something, feel free to open an issue.

---

<div align="center">

Built with ❤️ by **[Devesh Samant](https://deveshsamant.in/)**

[![Portfolio](https://img.shields.io/badge/🌐_Portfolio-deveshsamant.in-ffa116?style=flat-square&labelColor=1a1a2e)](https://deveshsamant.in/)

*If this helped you — drop a ⭐ on the repo!*

</div>
