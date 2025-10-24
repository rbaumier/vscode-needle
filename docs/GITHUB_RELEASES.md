# Guide de publication des releases GitHub

## 📦 Créer et publier une nouvelle release

### Méthode 1: Via l'interface GitHub (Recommandé)

1. **Aller sur la page releases**
   - https://github.com/rbaumier/vscode-go-to-fuzzy/releases

2. **Cliquer sur "Draft a new release"**

3. **Créer un nouveau tag**
   - Tag version: `v0.0.4`
   - Target: `master`

4. **Remplir les informations**
   - Release title: `v0.0.4 - Infrastructure Modernization`
   - Description: Copier depuis CHANGELOG.md

5. **Attacher le fichier VSIX**
   - Drag & drop: `releases/go-to-fuzzy-0.0.4.vsix`

6. **Publier**
   - Cliquer sur "Publish release"

---

### Méthode 2: Via GitHub CLI (gh)

```bash
# Installer gh si nécessaire
# brew install gh (macOS)
# sudo apt install gh (Linux)

# S'authentifier
gh auth login

# Créer la release avec le VSIX
gh release create v0.0.4 \
  releases/go-to-fuzzy-0.0.4.vsix \
  --title "v0.0.4 - Infrastructure Modernization" \
  --notes-file RELEASE_NOTES.md
```

---

## 📝 Template de notes de release

Créer un fichier `RELEASE_NOTES.md` pour chaque version :

```markdown
## 🎯 What's New

### Infrastructure Modernization
- 🦊 **Bun**: Complete migration from Yarn to Bun for faster installs and builds
- 🌿 **Biome**: Replaced ESLint/Prettier with Biome for 100x faster linting
- 🎯 **Ultracite**: Added intelligent import management
- 📦 **OpenVSX**: Now published on OpenVSX for native Cursor support

### Technical Improvements
- Package manager: Yarn → Bun (10x faster)
- Bundler: esbuild → Bun build (integrated)
- Linter: ESLint → Biome (100x faster)
- VSCode engine: ^1.55.0 → ^1.80.0 (broader Cursor compatibility)

### Breaking Changes
None - fully backward compatible

## 📥 Installation

### VSCode
Install from [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=rbaumier.go-to-fuzzy)

### Cursor
Install from [OpenVSX](https://open-vsx.org/extension/rbaumier/go-to-fuzzy)

### Manual Installation
Download `go-to-fuzzy-0.0.4.vsix` and install via Extensions → ... → Install from VSIX

## 🔗 Links
- [Full Changelog](https://github.com/rbaumier/vscode-go-to-fuzzy/blob/master/CHANGELOG.md)
- [OpenVSX Publishing Guide](https://github.com/rbaumier/vscode-go-to-fuzzy/blob/master/docs/OPENVSX_PUBLISHING.md)
```

---

## 🤖 Workflow automatisé (futur)

Pour automatiser la publication, créer `.github/workflows/release.yml` :

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install

      - name: Build
        run: bun run build

      - name: Package
        run: bun run package

      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: |
            *.vsix
          body_path: RELEASE_NOTES.md
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Publish to VSCode Marketplace
        run: bun run publish:vscode
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}

      - name: Publish to OpenVSX
        run: bun run publish:ovsx
        env:
          OVSX_TOKEN: ${{ secrets.OVSX_TOKEN }}
```

---

## 📋 Checklist avant release

- [ ] Version bumped dans `package.json`
- [ ] `CHANGELOG.md` mis à jour
- [ ] Tests passent (`bun test`)
- [ ] Lint passe (`bun run lint`)
- [ ] Build réussit (`bun run build`)
- [ ] Package créé (`bun run package`)
- [ ] VSIX testé localement
- [ ] Commit et push des changements
- [ ] Tag créé (`git tag v0.0.4`)
- [ ] Tag pushé (`git push origin v0.0.4`)
- [ ] Release GitHub créée
- [ ] VSIX attaché à la release
- [ ] Publié sur VSCode Marketplace
- [ ] Publié sur OpenVSX

---

## 🔄 Workflow complet

```bash
# 1. Bump version
# Éditer package.json: "version": "0.0.5"

# 2. Mettre à jour CHANGELOG.md
# Ajouter section [0.0.5]

# 3. Build et test
bun run lint
bun run build
bun run package

# 4. Commit
git add .
git commit -m "chore: release v0.0.5"

# 5. Tag
git tag -a v0.0.5 -m "Release v0.0.5"

# 6. Push
git push origin master --tags

# 7. Créer release GitHub (via gh ou interface)
gh release create v0.0.5 \
  releases/go-to-fuzzy-0.0.5.vsix \
  --title "v0.0.5 - Description" \
  --notes "Release notes..."

# 8. Publier sur marketplaces
bun run publish:all
```
