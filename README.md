# Vercel-XHTTP
رله‌ی XHTTP روی Vercel Edge برای پنهان کردن سرور Xray/V2Ray پشت دامنه‌ی *.vercel.app — شامل راهنمای کامل فارسی از صفر تا صد


# راهنمای کامل فارسی — Vercel XHTTP Relay

این یک رِله (relay) ساده روی **Vercel Edge Function** هست که ترافیک **XHTTP** کلاینت Xray/V2Ray رو به سرور Xray پشتی شما فوروارد می‌کنه. هدف: استفاده از شبکه‌ی جهانی Vercel و دامنه‌ی `*.vercel.app` به‌عنوان پوشش (front) برای IP سرور اصلی.

---

## فهرست

- [این پروژه برای کیه؟](#این-پروژه-برای-کیه)
- [نحوه‌ی کار (معماری)](#نحوه‌ی-کار-معماری)
- [محدودیت‌ها و هشدارها](#محدودیت‌ها-و-هشدارها)
- [پیش‌نیازها](#پیش‌نیازها)
- [مرحله ۱ — خرید VPS](#مرحله-۱--خرید-vps)
- [مرحله ۲ — تنظیم دامنه و DNS](#مرحله-۲--تنظیم-دامنه-و-dns)
- [مرحله ۳ — اتصال SSH به VPS](#مرحله-۳--اتصال-ssh-به-vps)
- [مرحله ۴ — نصب Xray](#مرحله-۴--نصب-xray)
- [مرحله ۵ — گرفتن TLS Certificate](#مرحله-۵--گرفتن-tls-certificate)
- [مرحله ۶ — کانفیگ Xray با XHTTP](#مرحله-۶--کانفیگ-xray-با-xhttp)
- [مرحله ۷ — Deploy روی Vercel](#مرحله-۷--deploy-روی-vercel)
- [مرحله ۸ — کانفیگ کلاینت](#مرحله-۸--کانفیگ-کلاینت)
- [محدودیت‌های Vercel](#محدودیت‌های-vercel)
- [عیب‌یابی](#عیب‌یابی)
- [سوالات متداول](#سوالات-متداول)

---

## این پروژه برای کیه؟

این پروژه فقط زمانی به دردت می‌خوره که **خودت یک سرور Xray با XHTTP داری** و می‌خوای IP اون رو با Vercel استتار کنی.

❌ **به دردت نمی‌خوره** اگر:
- فقط یه کانفیگ آماده (vless/vmess) از فروشنده گرفتی
- کانفیگت WebSocket / gRPC / Reality / Trojan / TCP هست
- می‌خوای بدون VPS فقط با Vercel پروکسی بسازی

✅ **به دردت می‌خوره** اگر:
- VPS داری یا می‌خوای بگیری
- می‌خوای transport رو **XHTTP** بذاری
- می‌خوای IP سرورت پنهان بمونه

---

## نحوه‌ی کار (معماری)

```
┌──────────┐  TLS, SNI=vercel.com   ┌──────────────┐  HTTP/2   ┌──────────────┐
│  کلاینت   │ ─────────────────────► │ Vercel Edge  │ ────────► │  سرور Xray   │
│ (v2rayN/  │      XHTTP request     │  (relay)     │  forward  │ XHTTP inbound│
│  Hiddify) │                        │              │           │              │
└──────────┘                        └──────────────┘            └──────────────┘
```

1. کلاینت با SNI=`vercel.com` به دامنه‌ی Vercel وصل می‌شه. برای سانسورچی شبیه ترافیک عادی Vercel به‌نظر می‌رسه.
2. Vercel Edge Function بدنه‌ی request رو **بدون buffer** به سرور Xray فوروارد می‌کنه.
3. پاسخ هم به همون صورت stream می‌شه برمی‌گرده.

---

## محدودیت‌ها و هشدارها

⚠️ **فقط XHTTP**: WebSocket, gRPC, TCP, mKCP, QUIC و Reality روی Vercel Edge کار **نمی‌کنه** (محدودیت runtime).

⚠️ **TOS Vercel**: استفاده‌ی proxy ممکنه TOS رو نقض کنه. اگه ترافیک بالا باشه، اکانتت ممکنه suspend بشه. ترافیک رو متعادل نگه دار.

⚠️ **آموزشی**: این repo برای آموزش و تست شخصیه، نه production. هیچ SLA و پشتیبانی نداره.

---

## پیش‌نیازها

| مورد | توضیح |
|---|---|
| **VPS** | یک سرور لینوکس خارج از ایران با IP عمومی (ترجیحاً Ubuntu 22.04 یا 24.04) |
| **دامنه** | یک دامنه (پولی یا رایگان مثل DuckDNS) که A record اون به IP سرور اشاره کنه |
| **اکانت Vercel** | رایگان از [vercel.com](https://vercel.com) |
| **Node.js + npm** | روی سیستم محلی برای Vercel CLI (می‌تونی از داشبورد هم deploy کنی) |
| **اکانت GitHub** | اختیاری، اگه از روش Dashboard استفاده می‌کنی |

### ابزارهای لازم بر اساس سیستم‌عامل

این راهنما هم برای **ویندوز** و هم **مک/لینوکس** نوشته شده. در هر مرحله بسته به OS خودت دستورات معادل رو می‌بینی.

#### 🪟 ویندوز (Windows 10/11)

همه‌ی ابزارهای زیر **رایگان** هستن:

| ابزار | لینک نصب | کاربرد |
|---|---|---|
| **PowerShell** | از قبل نصبه (در منوی Start جستجو کن) | اجرای دستورات |
| **OpenSSH Client** | از قبل در Win10/11 نصبه ([راهنما](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse)) | اتصال SSH |
| **Git for Windows** | [git-scm.com/download/win](https://git-scm.com/download/win) | git + Git Bash |
| **Node.js LTS** | [nodejs.org](https://nodejs.org) — installer رو دانلود و Next-Next-Finish | برای Vercel CLI |
| **PuTTY** (اختیاری) | [putty.org](https://www.putty.org/) | جایگزین SSH با GUI |

> 💡 **توصیه:** بعد از نصب Git for Windows از **Git Bash** استفاده کن، چون دستورات یونیکسی (مثل `curl`, `ssh`, `cat`) داخلش طبیعی کار می‌کنن. این راهنما رو راحت‌تر می‌کنه.

#### 🍎 مک / 🐧 لینوکس

| ابزار | روش نصب |
|---|---|
| **Terminal** | از قبل نصبه |
| **ssh, curl, dig** | از قبل نصبن |
| **Homebrew** (Mac) | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| **Node.js** | `brew install node` (Mac) یا `apt install nodejs npm` (Linux) |
| **Git** | `brew install git` (Mac) یا `apt install git` (Linux) |

---

## مرحله ۱ — خرید VPS

### پیشنهادها

| ارائه‌دهنده | قیمت ماهانه | لوکیشن پیشنهادی |
|---|---|---|
| **Hetzner** | ~€4.5 | Frankfurt / Helsinki |
| **Contabo** | ~$4.5 | EU / US |
| **Vultr** | $5-6 | EU / US |
| **DigitalOcean** | $6 | متعدد |

### مشخصات حداقلی
- RAM: ۱ GB
- CPU: ۱ vCPU
- Disk: ۲۰ GB SSD
- Bandwidth: حداقل ۱ TB/ماه
- OS: **Ubuntu 22.04** یا **24.04**

پس از خرید، **IP عمومی** و **رمز SSH** رو از داشبورد بگیر.

---

## مرحله ۲ — تنظیم دامنه و DNS

### اگه دامنه نداری
- پولی: [Namecheap](https://www.namecheap.com), [Porkbun](https://porkbun.com), [Cloudflare Registrar](https://www.cloudflare.com/products/registrar/)
- رایگان: [DuckDNS](https://www.duckdns.org/)

### تنظیم A Record (در Cloudflare)

1. وارد [dash.cloudflare.com](https://dash.cloudflare.com) شو
2. روی دامنه‌ت کلیک کن → منوی **DNS → Records**
3. **Add record**:

| فیلد | مقدار |
|---|---|
| **Type** | `A` |
| **Name** | `xray` (یا هر چیز دلخواه — می‌شه `xray.yourdomain.com`) |
| **IPv4 address** | IP عمومی VPS تو (مثلاً `144.208.66.185`) |
| **Proxy status** | ⚫ **DNS only** (خاکستری، **نه** نارنجی) |
| **TTL** | `Auto` |

> 🔴 **Proxy status حتماً DNS only باشه**. اگه Proxied بذاری، Cloudflare وسط ترافیک قرار می‌گیره و کار نمی‌کنه.

### تست DNS

**🍎 Mac / 🐧 Linux:**
```bash
dig @8.8.8.8 xray.yourdomain.com +short
```

**🪟 Windows (PowerShell):**
```powershell
Resolve-DnsName xray.yourdomain.com -Server 8.8.8.8 -Type A
```

یا با `nslookup`:
```powershell
nslookup xray.yourdomain.com 8.8.8.8
```

**🪟 Windows (Git Bash):**
```bash
nslookup xray.yourdomain.com 8.8.8.8
```

باید **IP سرور تو** رو برگردونه. ممکنه ۱-۵ دقیقه طول بکشه.

---

## مرحله ۳ — اتصال SSH به VPS

### 🍎 Mac / 🐧 Linux / 🪟 Windows (PowerShell یا Git Bash)

```bash
ssh root@YOUR_VPS_IP
```

اولین بار `yes` بزن. رمز رو وارد کن (هنگام تایپ نشون داده نمی‌شه — این طبیعیه).

### 🪟 Windows با PuTTY (اگه CLI سخته)

1. PuTTY رو باز کن
2. **Host Name (or IP address):** `YOUR_VPS_IP`
3. **Port:** `22`
4. **Connection type:** `SSH`
5. **Open** بزن
6. اولین بار **Accept** بزن
7. login: `root` + Enter، رمز رو وارد کن

> 💡 پس از این مرحله، تمام دستوراتی که با `#` (یا `root@vps:~#`) شروع می‌شن، **داخل سرور SSH** اجرا می‌شن — مهم نیست از Mac وصل شدی یا Windows.

### چک OS

```bash
cat /etc/os-release
```

باید Ubuntu 22.04 یا 24.04 رو ببینی.

---

## مرحله ۴ — نصب Xray

### آپدیت سیستم و نصب پکیج‌ها

```bash
apt update && apt upgrade -y
apt install -y curl socat cron ufw
```

### نصب Xray با اسکریپت رسمی

```bash
bash -c "$(curl -L https://github.com/XTLS/Xray-install/raw/main/install-release.sh)" @ install
```

پس از چند ثانیه:
```
info: Xray vXX.X.X is installed.
```

### چک نسخه

```bash
xray version
```

> ⚠️ نسخه باید **حداقل v1.8.16** باشه (برای XHTTP). نسخه‌های جدیدتر (مثل ۲۶.x) بهترن.

### تولید UUID

```bash
xray uuid
```

خروجی مثل:
```
05282829-6aaa-4ce8-9aca-a7ba3cad5d25
```

**این UUID رو ذخیره کن** — بعداً تو کانفیگ سرور و کلاینت لازمه.

### فعال‌سازی سرویس

```bash
systemctl enable xray
```

### تنظیم فایروال

```bash
ufw allow 22/tcp      # SSH
ufw allow 80/tcp      # برای صدور cert
ufw allow 443/tcp     # برای آینده
ufw allow 2096/tcp    # پورت Xray ما
ufw --force enable
ufw status
```

> ⚠️ قبل از `ufw --force enable` مطمئن شو پورت ۲۲ allow شده، وگرنه ارتباط SSH قطع می‌شه.

---

## مرحله ۵ — گرفتن TLS Certificate

از **acme.sh** + **Let's Encrypt** استفاده می‌کنیم (رایگان، خودکار).

### نصب acme.sh

```bash
curl https://get.acme.sh | sh -s email=your@email.com
source ~/.bashrc
```

### تنظیم CA پیش‌فرض

```bash
~/.acme.sh/acme.sh --set-default-ca --server letsencrypt
```

### اطمینان از خالی بودن پورت ۸۰

```bash
ss -tlnp | grep :80
```

اگه چیزی listen می‌کنه (مثل apache یا nginx)، خاموشش کن:
```bash
systemctl stop apache2 2>/dev/null
systemctl disable apache2 2>/dev/null
systemctl stop nginx 2>/dev/null
```

### صدور certificate

```bash
~/.acme.sh/acme.sh --issue -d xray.yourdomain.com --standalone -k ec-256
```

> جای `xray.yourdomain.com` دامنه‌ی واقعی خودت رو بذار.

خروجی موفق:
```
Cert success.
Your cert is in: /root/.acme.sh/xray.yourdomain.com_ecc/...
```

### نصب cert در مسیر Xray

```bash
mkdir -p /etc/xray

~/.acme.sh/acme.sh --install-cert -d xray.yourdomain.com --ecc \
  --fullchain-file /etc/xray/cert.pem \
  --key-file /etc/xray/key.pem \
  --reloadcmd "systemctl restart xray"

chown -R nobody:nogroup /etc/xray
chmod 644 /etc/xray/cert.pem
chmod 640 /etc/xray/key.pem
ls -la /etc/xray/
```

باید `cert.pem` و `key.pem` رو ببینی.

---

## مرحله ۶ — کانفیگ Xray با XHTTP

### آماده‌سازی لاگ‌ها

```bash
mkdir -p /var/log/xray
touch /var/log/xray/access.log /var/log/xray/error.log
chown -R nobody:nogroup /var/log/xray
cp /usr/local/etc/xray/config.json /usr/local/etc/xray/config.json.bak 2>/dev/null || true
```

### نوشتن کانفیگ

> 📝 **قبل از پیست**، این مقادیر رو در ذهن داشته باش:
> - `YOUR-UUID-HERE` → UUID که از `xray uuid` گرفتی
> - `xray.yourdomain.com` → دامنه‌ی واقعی خودت
> - `/yourpath` → یه path دلخواه (مثلاً `/myapppath`)

```bash
cat > /usr/local/etc/xray/config.json << 'EOF'
{
  "log": {
    "loglevel": "warning",
    "access": "/var/log/xray/access.log",
    "error": "/var/log/xray/error.log"
  },
  "inbounds": [
    {
      "tag": "xhttp-in",
      "listen": "0.0.0.0",
      "port": 2096,
      "protocol": "vless",
      "settings": {
        "clients": [
          { "id": "YOUR-UUID-HERE", "flow": "" }
        ],
        "decryption": "none"
      },
      "streamSettings": {
        "network": "xhttp",
        "security": "tls",
        "tlsSettings": {
          "alpn": ["h2", "http/1.1"],
          "certificates": [
            {
              "certificateFile": "/etc/xray/cert.pem",
              "keyFile": "/etc/xray/key.pem"
            }
          ]
        },
        "xhttpSettings": {
          "path": "/yourpath",
          "host": "xray.yourdomain.com",
          "mode": "auto"
        }
      }
    }
  ],
  "outbounds": [
    { "protocol": "freedom", "tag": "direct" },
    { "protocol": "blackhole", "tag": "blocked" }
  ]
}
EOF
```

> ⚠️ بعد از پیست، فایل رو با `nano /usr/local/etc/xray/config.json` باز کن و سه مقدار `YOUR-UUID-HERE`, `/yourpath`, `xray.yourdomain.com` رو با مقادیر واقعی جایگزین کن.

### تست syntax کانفیگ

```bash
xray -test -config /usr/local/etc/xray/config.json
```

باید ببینی: `Configuration OK.`

### راه‌اندازی Xray

```bash
systemctl restart xray
systemctl status xray --no-pager
ss -tlnp | grep 2096
```

### تست محلی

```bash
curl -vk https://127.0.0.1:2096/yourpath
```

اگه `HTTP/2 404` گرفتی → عالیه! (404 طبیعیه چون UUID نفرستادی، یعنی Xray داره کار می‌کنه.)

---

## مرحله ۷ — Deploy روی Vercel

دو روش: **CLI** (سریع‌تر) یا **Dashboard** (با GitHub).

### روش A: Vercel CLI

#### نصب Node.js و Vercel CLI

**🍎 Mac:**
```bash
# اگه Homebrew نداری
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node
sudo npm i -g vercel
vercel --version
```

**🐧 Linux (Ubuntu/Debian):**
```bash
sudo apt update
sudo apt install -y nodejs npm
sudo npm i -g vercel
vercel --version
```

**🪟 Windows:**

1. **نصب Node.js:**
   - برو [nodejs.org](https://nodejs.org)
   - نسخه‌ی **LTS** رو دانلود کن (فایل `.msi`)
   - دابل‌کلیک کن، Next تا Finish
   - حتماً تیک **Add to PATH** فعال باشه

2. **نصب Vercel CLI** (در PowerShell یا Git Bash):
   ```powershell
   npm i -g vercel
   vercel --version
   ```
   
   اگه permission error داد، PowerShell رو **As Administrator** باز کن و دوباره بزن.

#### لاگین به Vercel

**در هر سیستم‌عاملی:**
```bash
vercel login
```

با فلش `Continue with Email` رو انتخاب کن، ایمیلت رو بزن، روی لینک تأیید کلیک کن.

#### Deploy اولیه

**🍎 Mac / 🐧 Linux / 🪟 Git Bash:**
```bash
git clone https://github.com/YOUR-USERNAME/vercel-xhttp-relay.git
cd vercel-xhttp-relay
vercel
```

**🪟 Windows PowerShell:**
```powershell
git clone https://github.com/YOUR-USERNAME/vercel-xhttp-relay.git
cd vercel-xhttp-relay
vercel
```

سؤالات:
- `Set up and deploy?` → `Y`
- `Link to existing project?` → `N`
- `Project name?` → اسم دلخواه
- `Override settings?` → `N`

#### تنظیم Environment Variable

```bash
vercel env add TARGET_DOMAIN
```

- مقدار: `https://xray.yourdomain.com:2096`
- Environments: فقط `Production` و `Preview` رو با Space تیک بزن (Development رو **نزن**)
- Git branch: خالی Enter
- Make sensitive: `n`

#### Deploy نهایی

```bash
vercel --prod
```

URL مثل `https://your-project.vercel.app` می‌گیری.

### روش B: Dashboard (با GitHub)

1. ریپوی این پروژه رو fork یا clone کن و به GitHub خودت push کن.
2. در [vercel.com/new](https://vercel.com/new) ریپو رو **Import** کن.
3. در صفحه‌ی تنظیمات، بخش **Environment Variables**:
   - `TARGET_DOMAIN` = `https://xray.yourdomain.com:2096`
4. **Deploy** بزن.

### غیرفعال کردن Deployment Protection

اگه موقع setup گزینه‌ی **Vercel Authentication** رو روشن گذاشتی، باید خاموشش کنی وگرنه relay کار نمی‌کنه:

1. داشبورد Vercel → پروژه → **Settings → Deployment Protection**
2. **Vercel Authentication** رو روی **Disabled** بذار
3. **Save**

### تست relay

**🍎 Mac / 🐧 Linux / 🪟 Git Bash / 🪟 PowerShell (Win 10+):**
```bash
curl -I https://your-project.vercel.app/yourpath
```

**🪟 Windows PowerShell (نسخه‌ی native):**
```powershell
Invoke-WebRequest -Uri "https://your-project.vercel.app/yourpath" -Method Head
```

> 💡 در ویندوز ۱۰+ خود `curl.exe` نصبه و کار می‌کنه.

| خروجی | معنی |
|---|---|
| `HTTP/2 404` | ✅ همه چیز درسته |
| `HTTP/2 401` + HTML login | Deployment Protection روشنه |
| `HTTP/2 500` | env var ست نشده |
| `HTTP/2 502` | TARGET_DOMAIN غلطه |

---

## مرحله ۸ — کانفیگ کلاینت

### مقادیر کانفیگ

```
UUID:        UUID خودت
Address:     vercel.com
Port:        443
SNI:         vercel.com
Type:        xhttp
Path:        /yourpath
Host:        your-project.vercel.app
Mode:        auto
TLS:         on
ALPN:        h2
Fingerprint: chrome
```

### لینک VLESS share

```
vless://YOUR-UUID@vercel.com:443?encryption=none&security=tls&sni=vercel.com&alpn=h2&fp=chrome&type=xhttp&path=%2Fyourpath&host=your-project.vercel.app&mode=auto#Vercel-Relay
```

> توجه: `/` در path رو با `%2F` encode کن.

### کلاینت‌های پیشنهادی

| پلتفرم | کلاینت |
|---|---|
| Windows | **v2rayN** (v6.45+) |
| Android | **v2rayNG**, **Hiddify** |
| iOS | **V2Box**, **Streisand** |
| macOS | **V2Box**, **Hiddify** |
| Linux | **Hiddify**, **xray-core** |

### نکات تنظیم

- **Core**: حتماً `Xray-core` (نه V2Ray-core، چون XHTTP رو V2Ray ساپورت نمی‌کنه)
- **Mux**: خاموش (`OFF`)
- **Routing**: Bypass LAN/Iran رو روشن کن
- **Allow Insecure**: `OFF`

### تست بعد از اتصال

تو مرورگر برو:
```
https://ifconfig.me
```

باید **IP سرور VPS تو** رو نشون بده، نه IP ایران.

---

## محدودیت‌های Vercel

| محدودیت | Hobby (رایگان) | Pro |
|---|---|---|
| Bandwidth | ۱۰۰ GB/ماه | ۱ TB/ماه |
| Edge Requests | ۱M/ماه | ۱۰M/ماه |
| CPU/request | ~۵۰ms | ~۵۰ms |
| Wall-clock/request | ۲۵ ثانیه | ۳۰۰ ثانیه |

### تخمین مصرف Hobby (۱۰۰ GB)

| استفاده | تقریباً |
|---|---|
| چت / تلگرام | عملاً نامحدود |
| استریم موزیک | عملاً نامحدود |
| یوتیوب 720p | ~۱۰۰ ساعت/ماه |
| یوتیوب 1080p | ~۳۵-۵۰ ساعت/ماه |
| یوتیوب 4K / دانلود | ~۱۴ ساعت/ماه |

---

## عیب‌یابی

### `502 Bad Gateway: Tunnel Failed`
Vercel به سرور پشتی نمی‌رسه. چک کن:
- `TARGET_DOMAIN` دقیقاً درسته (`https://...:port`)
- Xray در سرور بالاست: `systemctl status xray`
- پورت در فایروال بازه: `ufw status`

### `500 Misconfigured: TARGET_DOMAIN is not set`
Env var ست نشده یا redeploy نشده. بزن:
```bash
vercel env ls
vercel --prod
```

### `401 Unauthorized` با HTML login
Vercel Authentication روشنه. در داشبورد → Settings → Deployment Protection → Disabled.

### کلاینت وصل می‌شه ولی ترافیک رد نمی‌شه
- Mux رو خاموش کن
- Core رو روی `Xray-core` بذار
- Routing → Bypass Iran رو فعال کن

### TLS handshake error در کلاینت
- SNI رو از `vercel.com` به `your-project.vercel.app` عوض کن
- ALPN رو فقط `h2` بذار

### کلاینت فقط روی Wi-Fi کار می‌کنه نه دیتای موبایل
ISP موبایل ممکنه `*.vercel.app` رو bottleneck کنه. یه Custom Domain به Vercel وصل کن (Settings → Domains).

### `Configuration OK` ولی Xray کرش می‌کنه
لاگ خطا رو ببین:
```bash
tail -50 /var/log/xray/error.log
```
معمولاً مشکل دسترسی فایل cert/key. با این درست کن:
```bash
chown -R nobody:nogroup /etc/xray /var/log/xray
```

---

## سوالات متداول

### آیا می‌تونم با Cloudflare به‌جای Vercel این کار رو بکنم؟
بله، ولی با کد متفاوت (Cloudflare Workers). برای WebSocket، Cloudflare Workers بهتره. برای XHTTP، Vercel به‌خاطر streaming WebStreams پایدارتره.

### اگه `*.vercel.app` در ایران فیلتر بشه؟
یه دامنه‌ی شخصی به Vercel وصل کن (Settings → Domains → Add). بعد در کلاینت `host` و `address` رو همون بذار.

### چند کاربر می‌تونن همزمان وصل بشن؟
محدودیت سختی نیست، ولی برای هر کاربر یه UUID جدا بساز:
```json
"clients": [
  { "id": "uuid-1", "email": "user1@example.com" },
  { "id": "uuid-2", "email": "user2@example.com" }
]
```

### آیا می‌تونم پورت ۲۰۹۶ رو عوض کنم؟
بله. پورت دلخواه رو در `config.json` بذار، در ufw allow کن، و در `TARGET_DOMAIN` در Vercel همون پورت رو بذار.

### چطور لاگ Vercel رو ببینم؟
```bash
vercel logs --follow
```
یا در داشبورد → پروژه → **Logs**.

### بعد از تغییر کانفیگ Xray باید چی کار کنم؟
```bash
xray -test -config /usr/local/etc/xray/config.json
systemctl restart xray
```

### Certificate تمدید خودکار می‌شه؟
بله. acme.sh یه cron job می‌سازه و هر ۶۰ روز خودکار renew می‌کنه. می‌تونی manual تست کنی:
```bash
~/.acme.sh/acme.sh --renew -d xray.yourdomain.com --force --ecc
```

---

## License

MIT — مثل پروژه‌ی اصلی.

## Disclaimer

این پروژه برای آموزش و تست شخصیه. مسئولیت استفاده با خودته. قوانین کشور و TOS Vercel رو رعایت کن.
