# Hotel Aagaman - 24/7 Cloud Deployment Guide (GitHub & Render.com)

તમારી નવી વેબસાઇટ **Hotel Aagaman** ને ક્લાઉડ પર મૂકવા માટે (જેથી લેપટોપ બંધ હોય તો પણ આખી દુનિયામાંથી ૨૪ કલાક લાઈવ ચાલે):

---

### પગલું ૧: GitHub પર નવી ફ્રી Repository બનાવો
1. [github.com/new](https://github.com/new) ખોલો (તમારા GitHub એકાઉન્ટમાં લૉગિન કરો).
2. **Repository name** માં લખો: `hotel-aagaman`
3. **Public** અથવા **Private** ગમે તે પસંદ કરો (Public રખાય જેથી ફ્રી સર્વિસ સાથે સરળતા રહે).
4. નીચે લીલા બટન **"Create repository"** પર ક્લિક કરો.

---

### પગલું ૨: તમારા કોડને GitHub પર પુશ કરો (Push Code)
VS Code ના ટર્મિનલમાં ફક્ત આ કમાન્ડ્સ ચલાવો (તમારા GitHub વપરાશકર્તા નામ સાથે):

```bash
git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/hotel-aagaman.git
git branch -M main
git push -u origin main
```
*(નોંધ: જો પહેલેથી remote હોય તો `git remote set-url origin https://github.com/<YOUR_GITHUB_USERNAME>/hotel-aagaman.git` વાપરો).*

---

### પગલું ૩: Render.com પર ૨૪ કલાક લાઈવ કરો (100% Free)
1. [render.com](https://render.com) પર જાઓ અને **"Sign in with GitHub"** કરો.
2. ઉપર જમણી બાજુ **"New +"** બટન પર ક્લિક કરી **"Web Service"** પસંદ કરો.
3. તમારી `hotel-aagaman` repository દેખાશે, ત્યાં **"Connect"** પર ક્લિક કરો.
4. સેટિંગ્સ આપોઆપ આવી જશે (કારણ કે આપણે `render.yaml` ફાઈલ તૈયાર કરી દીધી છે):
   - **Name**: `hotel-aagaman`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
5. નીચે **"Deploy Web Service"** પર ક્લિક કરો!

---

### લાઈવ લિંક તૈયાર!
૨ થી ૩ મિનિટમાં બિલ્ડ પૂર્ણ થતાં જ તમને કાયમી લિંક મળશે:
👉 `https://hotel-aagaman.onrender.com`

આ લિંક પરથી કોઈ પણ ગ્રાહક ગમે ત્યારે રૂમ બુકિંગ, ફૂડ ઓર્ડર કરી શકશે અને ડેટા લાઈવ સેવ થશે!
