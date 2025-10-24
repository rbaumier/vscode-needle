# Guide de publication OpenVSX

## 🎯 Pourquoi OpenVSX ?

Cursor utilise OpenVSX par défaut au lieu du VSCode Marketplace. Pour que l'extension soit disponible dans Cursor, elle doit être publiée sur OpenVSX.

## 📋 Étapes pour publier

### 1. Créer un compte OpenVSX

1. Aller sur https://open-vsx.org
2. Se connecter avec GitHub
3. Accepter le Eclipse Contributor Agreement (ECA)

### 2. Créer un namespace publisher

1. Une fois connecté, aller dans "Settings" → "Publishers"
2. Créer un nouveau publisher (ex: `rbaumier`)
3. Vérifier le publisher via GitHub (signature Eclipse requise)

### 3. Générer un Personal Access Token

1. Dans "Settings" → "Access Tokens"
2. Cliquer sur "Generate New Token"
3. Donner un nom descriptif (ex: "go-to-fuzzy-publish")
4. Copier le token généré **immédiatement** (il ne sera plus affiché)

### 4. Configurer la variable d'environnement

```bash
# Dans votre ~/.bashrc, ~/.zshrc, ou équivalent
export OVSX_TOKEN="votre_token_ici"

# Ou pour une session unique
export OVSX_TOKEN="votre_token_ici"
```

### 5. Builder et publier

```bash
# Builder le package
bun run build

# Créer le .vsix
bun run package

# Publier sur OpenVSX
bun run publish:ovsx

# Ou publier sur les deux marketplaces
bun run publish:all
```

## 🔍 Vérification

Après publication, vérifier que l'extension apparaît sur :
- https://open-vsx.org/extension/rbaumier/go-to-fuzzy

## 🐛 Troubleshooting

### Erreur: "Publisher not found"

Vérifier que le namespace dans `package.json` (`publisher: "rbaumier"`) correspond exactement au publisher créé sur OpenVSX.

### Erreur: "Authentication failed"

1. Vérifier que `$OVSX_TOKEN` est bien défini: `echo $OVSX_TOKEN`
2. Régénérer un nouveau token sur OpenVSX si nécessaire

### Erreur: "Extension already exists"

Si vous republiez la même version, il faut:
1. Incrémenter la version dans `package.json`
2. Mettre à jour `CHANGELOG.md`
3. Recréer le package

## 📦 Workflow complet

```bash
# 1. Faire les modifications
# 2. Incrémenter version
npm version patch  # ou minor, ou major

# 3. Mettre à jour CHANGELOG.md

# 4. Build et publish
bun run build
bun run package
bun run publish:all

# 5. Git tag et push
git add .
git commit -m "chore: release v0.0.4"
git tag v0.0.4
git push origin master --tags
```

## 🔗 Liens utiles

- OpenVSX: https://open-vsx.org
- Documentation: https://github.com/eclipse/openvsx/wiki/Publishing-Extensions
- Eclipse ECA: https://www.eclipse.org/legal/ECA.php
