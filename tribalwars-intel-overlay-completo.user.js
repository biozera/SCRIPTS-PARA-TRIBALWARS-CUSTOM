// ==UserScript==
// @name         Tribal Wars Intel Overlay - Completo
// @namespace    http://tampermonkey.net/
// @version      2.0.0
// @description  Overlay de inteligência completo para Tribal Wars com modo de ataque e cores baseadas em população
// @author       biozera
// @match        https://*.tribalwars.*/game.php*
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                  TRIBAL WARS INTEL OVERLAY - VERSÃO COMPLETA                 ║
╚══════════════════════════════════════════════════════════════════════════════╝

📋 FUNCIONALIDADES:
  • Modo de Ataque: Toggle com indicadores visuais (bordas e sombras vermelhas)
  • Cores por População: 6 faixas baseadas em pop_survivors
    - 0k-10k: Verde (#00FF00)
    - 10k-20k: Azul Claro (#ADD8E6)
    - 20k-50k: Amarelo (#FFFF00)
    - 50k-100k: Vermelho Claro (#FFB6C1)
    - 100k+: Vermelho Escuro (#8B0000)
    - Sem dados: Cinza (#808080)
  • Cores Personalizáveis: Painel completo de configuração
  • Filtro Temporal: Campo "Dias para ignorar relatórios" (padrão: 3 dias)

📦 COMO USAR:
  1. Instale o Tampermonkey (https://www.tampermonkey.net/)
  2. Adicione este script no Tampermonkey
  3. Acesse o jogo Tribal Wars
  4. Clique no botão ⚙️ Configurações Intel (canto superior direito)
  5. Configure as cores e modo de ataque
  6. Salve as configurações

⚙️ INTEGRAÇÃO NECESSÁRIA:
  Este script usa funções placeholder que precisam ser adaptadas ao seu ambiente:
  
  1. fetchVillageIntelData() - Buscar dados da tabela tw_village_intel_latest
     Exemplo com API REST:
       async function fetchVillageIntelData() {
         const response = await fetch('/api/village-intel-latest');
         return await response.json();
       }
     
     Exemplo com localStorage:
       function fetchVillageIntelData() {
         const data = localStorage.getItem('tw_village_intel_latest');
         return data ? JSON.parse(data) : [];
       }
  
  2. applyVillageColor() - Aplicar cores nos elementos do mapa
     Adapte os seletores CSS para a estrutura DOM do seu Tribal Wars:
       - Inspecione o mapa no DevTools
       - Identifique os seletores corretos
       - Atualize a função applyVillageColor()

📊 ESTRUTURA DE DADOS ESPERADA:
  [
    {
      village_id: 12345,
      x: 500,
      y: 500,
      pop_survivors: 15000,
      updated_at: "2026-01-10T14:30:00Z"
    },
    ...
  ]

🔒 SEGURANÇA:
  • CSS.escape() para prevenir injeção de seletores
  • Validação defensiva de entradas
  • parseInt com radix explícito
  • Prevenção de inicialização duplicada

═══════════════════════════════════════════════════════════════════════════════
*/

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════
    // CONFIGURAÇÕES PADRÃO
    // ═══════════════════════════════════════════════════════════════════════
    
    const DEFAULT_SETTINGS = {
        attackModeEnabled: false,
        daysToIgnore: 3,
        colors: {
            range0_10k: '#00FF00',      // Verde - 0k a 10k
            range10_20k: '#ADD8E6',     // Azul Claro - 10k a 20k
            range20_50k: '#FFFF00',     // Amarelo - 20k a 50k
            range50_100k: '#FFB6C1',    // Vermelho Claro - 50k a 100k
            range100kPlus: '#8B0000',   // Vermelho Escuro - 100k+
            noData: '#808080'           // Cinza - Sem informação
        }
    };

    // ═══════════════════════════════════════════════════════════════════════
    // FUNÇÕES DE ARMAZENAMENTO
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Carrega as configurações do armazenamento persistente
     * @returns {Object} Configurações salvas ou padrões
     */
    function loadSettings() {
        const savedSettings = GM_getValue('twIntelSettings', null);
        if (savedSettings) {
            try {
                const parsed = JSON.parse(savedSettings);
                return { 
                    ...DEFAULT_SETTINGS, 
                    ...parsed, 
                    colors: { ...DEFAULT_SETTINGS.colors, ...parsed.colors } 
                };
            } catch (e) {
                console.error('Erro ao carregar configurações:', e);
                return DEFAULT_SETTINGS;
            }
        }
        return DEFAULT_SETTINGS;
    }

    /**
     * Salva as configurações no armazenamento persistente
     * @param {Object} settings - Configurações a serem salvas
     */
    function saveSettings(settings) {
        GM_setValue('twIntelSettings', JSON.stringify(settings));
    }

    // Configurações atuais
    let settings = loadSettings();

    // ═══════════════════════════════════════════════════════════════════════
    // FUNÇÕES DE LÓGICA DE NEGÓCIO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Obtém a cor baseada na população
     * @param {number} population - População da aldeia
     * @returns {string} Código de cor hexadecimal
     */
    function getColorForPopulation(population) {
        if (population === null || population === undefined || population === '') {
            return settings.colors.noData;
        }

        const pop = parseInt(population, 10);
        if (isNaN(pop) || pop < 0) {
            return settings.colors.noData;
        }

        if (pop < 10000) {
            return settings.colors.range0_10k;
        } else if (pop < 20000) {
            return settings.colors.range10_20k;
        } else if (pop < 50000) {
            return settings.colors.range20_50k;
        } else if (pop < 100000) {
            return settings.colors.range50_100k;
        } else {
            return settings.colors.range100kPlus;
        }
    }

    /**
     * Filtra dados baseado na data de atualização
     * @param {Array} data - Array de dados de aldeias
     * @param {number} daysToIgnore - Número de dias para ignorar
     * @returns {Array} Dados filtrados
     */
    function filterRecentData(data, daysToIgnore) {
        if (!daysToIgnore || daysToIgnore <= 0) {
            return data;
        }

        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToIgnore);

        return data.filter(item => {
            if (!item.updated_at) {
                return false; // Exclui itens sem updated_at
            }
            const updatedDate = new Date(item.updated_at);
            return updatedDate >= cutoffDate;
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTERFACE DE USUÁRIO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Cria o painel de configurações
     * @returns {HTMLElement} Elemento do painel
     */
    function createSettingsPanel() {
        const panel = document.createElement('div');
        panel.id = 'twIntelSettingsPanel';
        panel.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #f4e4bc;
            border: 2px solid #7d510f;
            padding: 20px;
            z-index: 10000;
            width: 500px;
            max-height: 80vh;
            overflow-y: auto;
            box-shadow: 0 4px 8px rgba(0,0,0,0.3);
            font-family: Verdana, Arial, sans-serif;
            display: none;
        `;

        panel.innerHTML = `
            <h2 style="margin-top: 0; color: #7d510f; border-bottom: 2px solid #7d510f; padding-bottom: 10px;">
                Configurações do Overlay de Inteligência
            </h2>
            
            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                    <input type="checkbox" id="attackModeToggle" ${settings.attackModeEnabled ? 'checked' : ''}>
                    Habilitar Modo de Ataque
                </label>
            </div>

            <div style="margin-bottom: 15px;">
                <label style="display: block; margin-bottom: 5px; font-weight: bold;">
                    Dias para ignorar relatórios:
                </label>
                <input type="number" id="daysToIgnoreInput" value="${settings.daysToIgnore}" 
                       min="0" max="365" style="width: 100%; padding: 5px; border: 1px solid #7d510f;">
                <small style="color: #666;">Relatórios mais antigos que isso serão filtrados</small>
            </div>

            <h3 style="color: #7d510f; border-bottom: 1px solid #7d510f; padding-bottom: 5px; margin-top: 20px;">
                Faixas de Cores por População
            </h3>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">0k - 10k:</label>
                <input type="color" id="color0_10k" value="${settings.colors.range0_10k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">10k - 20k:</label>
                <input type="color" id="color10_20k" value="${settings.colors.range10_20k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">20k - 50k:</label>
                <input type="color" id="color20_50k" value="${settings.colors.range20_50k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">50k - 100k:</label>
                <input type="color" id="color50_100k" value="${settings.colors.range50_100k}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">100k+:</label>
                <input type="color" id="color100kPlus" value="${settings.colors.range100kPlus}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-bottom: 10px;">
                <label style="display: block; margin-bottom: 3px; font-weight: bold;">Informação Ausente:</label>
                <input type="color" id="colorNoData" value="${settings.colors.noData}" 
                       style="width: 100%; height: 40px; border: 1px solid #7d510f; cursor: pointer;">
            </div>

            <div style="margin-top: 20px; display: flex; gap: 10px;">
                <button id="saveSettingsBtn" style="
                    flex: 1;
                    padding: 10px;
                    background: #7d510f;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-weight: bold;
                ">Salvar</button>
                <button id="resetSettingsBtn" style="
                    flex: 1;
                    padding: 10px;
                    background: #a0522d;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-weight: bold;
                ">Restaurar Padrões</button>
                <button id="closeSettingsBtn" style="
                    flex: 1;
                    padding: 10px;
                    background: #999;
                    color: white;
                    border: none;
                    cursor: pointer;
                    font-weight: bold;
                ">Cancelar</button>
            </div>
        `;

        document.body.appendChild(panel);

        // Event listeners para os botões
        document.getElementById('saveSettingsBtn').addEventListener('click', () => {
            settings.attackModeEnabled = document.getElementById('attackModeToggle').checked;
            const daysInput = parseInt(document.getElementById('daysToIgnoreInput').value, 10);
            settings.daysToIgnore = (!isNaN(daysInput) && daysInput >= 0) ? daysInput : DEFAULT_SETTINGS.daysToIgnore;
            settings.colors.range0_10k = document.getElementById('color0_10k').value;
            settings.colors.range10_20k = document.getElementById('color10_20k').value;
            settings.colors.range20_50k = document.getElementById('color20_50k').value;
            settings.colors.range50_100k = document.getElementById('color50_100k').value;
            settings.colors.range100kPlus = document.getElementById('color100kPlus').value;
            settings.colors.noData = document.getElementById('colorNoData').value;

            saveSettings(settings);
            panel.style.display = 'none';
            redrawMapOverlay();
            alert('Configurações salvas com sucesso!');
        });

        document.getElementById('resetSettingsBtn').addEventListener('click', () => {
            if (confirm('Tem certeza que deseja restaurar todas as configurações para os valores padrão?')) {
                settings = { ...DEFAULT_SETTINGS };
                saveSettings(settings);
                document.getElementById('attackModeToggle').checked = settings.attackModeEnabled;
                document.getElementById('daysToIgnoreInput').value = settings.daysToIgnore;
                document.getElementById('color0_10k').value = settings.colors.range0_10k;
                document.getElementById('color10_20k').value = settings.colors.range10_20k;
                document.getElementById('color20_50k').value = settings.colors.range20_50k;
                document.getElementById('color50_100k').value = settings.colors.range50_100k;
                document.getElementById('color100kPlus').value = settings.colors.range100kPlus;
                document.getElementById('colorNoData').value = settings.colors.noData;
                alert('Configurações restauradas para os padrões!');
            }
        });

        document.getElementById('closeSettingsBtn').addEventListener('click', () => {
            panel.style.display = 'none';
        });

        return panel;
    }

    /**
     * Cria o botão de configurações
     * @returns {HTMLElement} Elemento do botão
     */
    function createSettingsButton() {
        const button = document.createElement('button');
        button.id = 'twIntelSettingsBtn';
        button.textContent = '⚙️ Configurações Intel';
        button.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            z-index: 9999;
            padding: 10px 15px;
            background: #7d510f;
            color: white;
            border: 2px solid #5a3a0a;
            cursor: pointer;
            font-weight: bold;
            border-radius: 5px;
            font-family: Verdana, Arial, sans-serif;
        `;

        button.addEventListener('click', () => {
            const panel = document.getElementById('twIntelSettingsPanel');
            if (panel) {
                panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            }
        });

        document.body.appendChild(button);
        return button;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTEGRAÇÃO COM DADOS (PLACEHOLDER - REQUER CUSTOMIZAÇÃO)
    // ═══════════════════════════════════════════════════════════════════════

    // Dados de inteligência das aldeias
    let villageIntelData = [];

    /**
     * Busca dados de inteligência das aldeias
     * 
     * ⚠️ IMPORTANTE: Esta é uma função PLACEHOLDER que precisa ser customizada!
     * 
     * OPÇÕES DE IMPLEMENTAÇÃO:
     * 
     * 1. API REST:
     *    async function fetchVillageIntelData() {
     *      try {
     *        const response = await fetch('/api/village-intel-latest');
     *        const data = await response.json();
     *        return data.villages || [];
     *      } catch (error) {
     *        console.error('Erro ao buscar dados:', error);
     *        return [];
     *      }
     *    }
     * 
     * 2. localStorage:
     *    function fetchVillageIntelData() {
     *      try {
     *        const data = localStorage.getItem('tw_village_intel_latest');
     *        return data ? JSON.parse(data) : [];
     *      } catch (error) {
     *        console.error('Erro ao carregar dados:', error);
     *        return [];
     *      }
     *    }
     * 
     * 3. GraphQL:
     *    async function fetchVillageIntelData() {
     *      const query = `
     *        query {
     *          villageIntel {
     *            village_id x y pop_survivors updated_at
     *          }
     *        }
     *      `;
     *      try {
     *        const response = await fetch('/graphql', {
     *          method: 'POST',
     *          headers: { 'Content-Type': 'application/json' },
     *          body: JSON.stringify({ query })
     *        });
     *        const result = await response.json();
     *        return result.data.villageIntel || [];
     *      } catch (error) {
     *        console.error('Erro GraphQL:', error);
     *        return [];
     *      }
     *    }
     * 
     * 4. Dados de teste (para desenvolvimento):
     *    function fetchVillageIntelData() {
     *      return [
     *        { village_id: 1, x: 500, y: 500, pop_survivors: 5000, updated_at: new Date().toISOString() },
     *        { village_id: 2, x: 501, y: 500, pop_survivors: 15000, updated_at: new Date().toISOString() },
     *        { village_id: 3, x: 502, y: 500, pop_survivors: 35000, updated_at: new Date().toISOString() },
     *        { village_id: 4, x: 503, y: 500, pop_survivors: 75000, updated_at: new Date().toISOString() },
     *        { village_id: 5, x: 504, y: 500, pop_survivors: 120000, updated_at: new Date().toISOString() }
     *      ];
     *    }
     * 
     * @returns {Array} Array de objetos com dados das aldeias
     */
    function fetchVillageIntelData() {
        // SUBSTITUIR ESTA IMPLEMENTAÇÃO COM SUA FONTE DE DADOS REAL
        console.warn('⚠️ fetchVillageIntelData() está usando implementação placeholder!');
        console.warn('⚠️ Customize esta função para buscar dados da sua fonte de dados.');
        return [];
    }

    // ═══════════════════════════════════════════════════════════════════════
    // FUNÇÕES DE OVERLAY DO MAPA
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Instala o hook do overlay no mapa
     * 
     * Esta função inicializa o sistema de overlay e integra com o mapa do Tribal Wars
     */
    function installMapOverlayHook() {
        console.log('Instalando Tribal Wars Intel Overlay...');
        
        // Verifica se TWMap existe (objeto do mapa do Tribal Wars)
        if (typeof TWMap === 'undefined') {
            console.warn('TWMap não encontrado, tentando novamente em 1 segundo...');
            setTimeout(installMapOverlayHook, 1000);
            return;
        }

        // Busca dados iniciais
        villageIntelData = fetchVillageIntelData();
        
        // Integra com o handler do mapa
        const originalMapHandler = TWMap.mapHandler;
        if (originalMapHandler) {
            TWMap.mapHandler = function() {
                originalMapHandler.apply(this, arguments);
                redrawMapOverlay();
            };
        }

        // Desenho inicial
        redrawMapOverlay();
        
        console.log('Tribal Wars Intel Overlay instalado com sucesso!');
    }

    /**
     * Redesenha o overlay do mapa com as configurações atuais
     * 
     * Esta função é chamada sempre que:
     * - O mapa é movido
     * - As configurações são alteradas
     * - Os dados são atualizados
     */
    function redrawMapOverlay() {
        console.log('Redesenhando overlay do mapa...');
        
        // Filtra dados baseado nas configurações
        const filteredData = filterRecentData(villageIntelData, settings.daysToIgnore);
        
        // Aplica cores às aldeias no mapa
        filteredData.forEach(village => {
            const color = getColorForPopulation(village.pop_survivors);
            applyVillageColor(village, color);
        });

        // Se modo de ataque está habilitado, aplica indicadores adicionais
        if (settings.attackModeEnabled) {
            applyAttackModeIndicators(filteredData);
        }
    }

    /**
     * Aplica cor a uma aldeia no mapa
     * 
     * ⚠️ IMPORTANTE: Esta função usa seletores PLACEHOLDER que precisam ser customizados!
     * 
     * COMO CUSTOMIZAR:
     * 1. Abra o Tribal Wars no navegador
     * 2. Pressione F12 para abrir as DevTools
     * 3. Use o seletor de elementos (Ctrl+Shift+C) para inspecionar uma aldeia no mapa
     * 4. Identifique os atributos/classes/IDs corretos dos elementos
     * 5. Atualize os seletores nesta função
     * 
     * EXEMPLOS DE SELETORES COMUNS:
     * 
     * - Tribal Wars Clássico:
     *   const villageElement = document.querySelector(`#map_village_${village.village_id}`);
     * 
     * - Tribal Wars com data-attributes:
     *   const villageElement = document.querySelector(`[data-villageid="${village.village_id}"]`);
     * 
     * - Tribal Wars com coordenadas:
     *   const villageElement = document.querySelector(`.village[data-x="${village.x}"][data-y="${village.y}"]`);
     * 
     * @param {Object} village - Objeto com dados da aldeia
     * @param {string} color - Código de cor hexadecimal
     */
    function applyVillageColor(village, color) {
        // Sanitiza village ID para prevenir injeção de seletores CSS
        const villageId = String(village.village_id).replace(/[^a-zA-Z0-9_-]/g, '');
        if (villageId) {
            // Usa CSS.escape se disponível, senão usa valor sanitizado
            const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(villageId) : villageId;
            
            // ⚠️ SUBSTITUIR ESTE SELETOR COM O CORRETO PARA SEU TRIBAL WARS
            const villageElement = document.querySelector(`[data-id="${escapedId}"]`);
            if (villageElement) {
                villageElement.style.backgroundColor = color;
                villageElement.style.opacity = '0.7';
            }
        }
        
        // Alternativa: busca por coordenadas (valida como números)
        const x = parseInt(village.x, 10);
        const y = parseInt(village.y, 10);
        if (!isNaN(x) && !isNaN(y)) {
            // Usa CSS.escape se disponível
            const escapedX = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(x)) : x;
            const escapedY = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(y)) : y;
            
            // ⚠️ SUBSTITUIR ESTE SELETOR COM O CORRETO PARA SEU TRIBAL WARS
            const coordElement = document.querySelector(`[data-x="${escapedX}"][data-y="${escapedY}"]`);
            if (coordElement) {
                coordElement.style.backgroundColor = color;
                coordElement.style.opacity = '0.7';
            }
        }
    }

    /**
     * Aplica indicadores visuais do modo de ataque
     * 
     * Esta função adiciona bordas e sombras vermelhas às aldeias quando
     * o modo de ataque está habilitado
     * 
     * @param {Array} villages - Array de aldeias para aplicar indicadores
     */
    function applyAttackModeIndicators(villages) {
        console.log('Aplicando indicadores do modo de ataque em', villages.length, 'aldeias');
        
        villages.forEach(village => {
            // Sanitiza village ID para prevenir injeção de seletores CSS
            const villageId = String(village.village_id).replace(/[^a-zA-Z0-9_-]/g, '');
            const x = parseInt(village.x, 10);
            const y = parseInt(village.y, 10);
            
            let villageElement = null;
            if (villageId) {
                const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(villageId) : villageId;
                villageElement = document.querySelector(`[data-id="${escapedId}"]`);
            }
            if (!villageElement && !isNaN(x) && !isNaN(y)) {
                const escapedX = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(x)) : x;
                const escapedY = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(String(y)) : y;
                villageElement = document.querySelector(`[data-x="${escapedX}"][data-y="${escapedY}"]`);
            }
            
            if (villageElement) {
                // Adiciona borda vermelha para modo de ataque
                villageElement.style.border = '2px solid red';
                villageElement.style.boxShadow = '0 0 5px red';
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INICIALIZAÇÃO
    // ═══════════════════════════════════════════════════════════════════════

    // Previne inicialização duplicada
    let isInitialized = false;

    /**
     * Inicializa o script
     * 
     * Esta função é chamada quando a página carrega e configura todos
     * os componentes necessários do overlay
     */
    function init() {
        if (isInitialized) {
            console.log('Tribal Wars Intel Overlay já foi inicializado.');
            return;
        }
        
        console.log('Tribal Wars Intel Overlay v2.0.0 inicializando...');
        
        // Aguarda o DOM estar completamente carregado
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }

        // Marca como inicializado
        isInitialized = true;

        // Cria elementos da interface
        createSettingsPanel();
        createSettingsButton();

        // Instala hook do overlay no mapa
        installMapOverlayHook();
        
        console.log('Intel Overlay inicializado. Modo de Ataque:', settings.attackModeEnabled);
    }

    // Inicia o script
    init();

})();

/*
╔══════════════════════════════════════════════════════════════════════════════╗
║                              NOTAS FINAIS                                    ║
╚══════════════════════════════════════════════════════════════════════════════╝

📝 CHECKLIST DE INTEGRAÇÃO:
  [ ] Implementar fetchVillageIntelData() com sua fonte de dados
  [ ] Ajustar seletores em applyVillageColor() para seu Tribal Wars
  [ ] Testar com dados reais
  [ ] Verificar se as cores aparecem no mapa
  [ ] Testar modo de ataque
  [ ] Validar filtro de dias

🐛 TROUBLESHOOTING:
  • Script não carrega: Verifique se Tampermonkey está ativo
  • Cores não aparecem: Ajuste os seletores CSS em applyVillageColor()
  • Dados não carregam: Implemente fetchVillageIntelData() corretamente
  • Configurações não salvam: Verifique permissões GM_setValue/GM_getValue

💡 SUPORTE:
  Para dúvidas ou problemas, verifique:
  1. Console do navegador (F12) para mensagens de erro
  2. Seletores CSS corretos no seu ambiente Tribal Wars
  3. Formato dos dados retornados por fetchVillageIntelData()

═══════════════════════════════════════════════════════════════════════════════
*/
