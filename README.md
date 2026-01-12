# Tribal Wars Intel Overlay - Script Completo

Script userscript completo para Tribal Wars com overlay de inteligência, modo de ataque e cores baseadas em população de sobreviventes.

## 🚀 Instalação Rápida

1. Instale o [Tampermonkey](https://www.tampermonkey.net/) no seu navegador
2. Abra o arquivo `tribalwars-intel-overlay-completo.user.js`
3. Clique em "Instalar" quando solicitado
4. Acesse o Tribal Wars
5. Clique no botão ⚙️ Configurações Intel (canto superior direito)

## ✨ Funcionalidades

- **Modo de Ataque**: Toggle com indicadores visuais (bordas e sombras vermelhas)
- **Cores por População**: 6 faixas baseadas em `pop_survivors`:
  - 0k-10k: Verde (#00FF00)
  - 10k-20k: Azul Claro (#ADD8E6)
  - 20k-50k: Amarelo (#FFFF00)
  - 50k-100k: Vermelho Claro (#FFB6C1)
  - 100k+: Vermelho Escuro (#8B0000)
  - Sem dados: Cinza (#808080)
- **Cores Personalizáveis**: Painel completo de configuração
- **Filtro Temporal**: Campo "Dias para ignorar relatórios" (padrão: 3 dias)

## ⚙️ Integração Necessária

O script contém **toda a documentação integrada como comentários**. Você precisa customizar duas funções:

### 1. fetchVillageIntelData()
Conectar à sua fonte de dados `tw_village_intel_latest`. O script inclui exemplos para:
- API REST
- localStorage
- GraphQL
- Dados de teste

### 2. applyVillageColor()
Ajustar os seletores CSS para corresponder à estrutura DOM do seu Tribal Wars.

**Todas as instruções detalhadas estão no próprio arquivo do script!**

## 📊 Estrutura de Dados

```json
[
  {
    "village_id": 12345,
    "x": 500,
    "y": 500,
    "pop_survivors": 15000,
    "updated_at": "2026-01-10T14:30:00Z"
  }
]
```

## 🔒 Segurança

- CSS.escape() nativo com fallback
- Validação defensiva de entradas
- parseInt com radix explícito
- Prevenção de inicialização duplicada

## 📝 Arquivo Único

Todo o código, documentação, exemplos e instruções estão em um único arquivo:
- `tribalwars-intel-overlay-completo.user.js`

## 💡 Suporte

Consulte os comentários dentro do script para:
- Exemplos de integração
- Troubleshooting
- Checklist de integração
- Notas técnicas completas
