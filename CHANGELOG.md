# Changelog

Todas as mudanças importantes do Grafo ficam registradas aqui.

## [1.4.1] - 2026-11-06

### Corrigido

- Janelas como **Inserir tabela**, **Novo quadro** e **Localizar** não tiram mais o foco do campo em que a pessoa já clicou: antes, um campo digitado logo na abertura podia receber o texto do outro (por exemplo, as colunas iam para as linhas).
- **Desfazer** depois de **Localizar e substituir** (ou de qualquer comando feito logo após outra alteração) volta só aquele comando: antes, uma alteração feita menos de 0,4 s antes era desfeita junto e podia apagar as camadas recém-criadas.
- Os testes automáticos não encerram mais antes da hora: a opção `--test-force-exit` fazia o Node pular testes sem acusar erro. Agora todos rodam sempre, cada teste tem tempo-limite e, no GitHub Actions, as falhas aparecem como anotações no próprio commit.

## [1.4.0] - 2026-11-06

### Adicionado

- **Criar com IA** (aba **IA** no painel da esquerda, botão ✦ no topo, Arquivo → Criar com IA…, Ctrl+Alt+I): descreva em português o que quer criar e o Grafo desenha o diagrama completo no quadro, já organizado e selecionado, com **Gerar outra versão**, **Desfazer**, exemplos prontos e pedidos recentes.
- A IA conhece as 107 formas e monta classes e interfaces UML com atributos, métodos, herança, realização, composição, agregação e multiplicidades; entidades com PK e FK e ligações de entidade-relacionamento; fluxogramas, BPMN, casos de uso, arquitetura, redes, organogramas e telas com layout manual.
- Provedores: **Anthropic (Claude), OpenAI, Google Gemini, OpenRouter, Ollama e LM Studio**, com modelo configurável.
- No navegador, no GitHub Pages e no `Grafo.html`, cada pessoa usa a própria chave, guardada só no navegador e enviada direto ao provedor, sem servidor.
- No app desktop, a chave fica cifrada pelo Windows (DPAPI) em `%LOCALAPPDATA%\Grafo\ai.dat` e o próprio app faz o pedido.
- No servidor, `GET /api/ai/status` e `POST /api/ai/request` com a chave no `.env` (`GRAFO_AI_PROVIDER`, `GRAFO_AI_API_KEY`, `GRAFO_AI_MODEL`, `GRAFO_AI_BASE_URL`, `GRAFO_AI_MAX_TOKENS`, `GRAFO_AI_RATE_LIMIT`), modelo e limite de tokens impostos pelo servidor, limite de pedidos por hora por IP e as métricas `grafo_ai_requests_total`, `grafo_ai_failures_total` e `grafo_ai_enabled`.
- Testes de unidade, ponta a ponta (com provedor simulado) e do servidor (com provedor simulado) para a área de IA.

### Alterado

- A Content-Security-Policy do `Grafo.html`, do servidor e do `npm run serve` libera conexões só para os provedores de IA conhecidos.
- Os nomes das camadas de classes com estereótipo (`«interface»`, `«abstract»`) agora são o nome da classe.
- O `Grafo.exe` passou a ter cerca de 8 MB por causa do cliente HTTPS da IA.
- Tutorial rápido, manuais em PDF e README atualizados para a versão 1.4.0.

## [1.3.0] - 2026-11-06

### Adicionado

- **Diagrama a partir de texto** (Arquivo → Diagrama a partir de texto…, Ctrl+Alt+M): lê fluxogramas em **Mermaid** (`graph`/`flowchart` com `TD`, `LR`, `BT` e `RL`; nós `[ ]`, `( )`, `([ ])`, `[[ ]]`, `[( )]`, `(( ))`, `{ }`, `{{ }}`, `[/ /]` e `> ]`; setas `-->`, `---`, `-.->` e `==>`; rótulos `|texto|` e `-- texto -->`; `&` e `subgraph`) ou uma **lista com recuo**, mostra a contagem antes de inserir e desenha tudo organizado em camadas, com seções para os grupos.
- **Copiar como Mermaid** (menu Arquivo e clique direito): exporta a seleção ou a página como `flowchart`, mantendo tipos de forma, rótulos e estilos de seta.
- **Localizar e substituir** (Ctrl+F / Ctrl+H): busca em todas as páginas ou só na atual, com maiúsculas e palavra inteira opcionais; Enter vai ao próximo resultado, troca de página e centraliza; substituir em uma camada ou em todas com um só desfazer.
- **Inserir tabela** (Shift+T, menu Objeto e clique direito) e **Tabela** na aba Dados para montar a tabela de um CSV.
- **Grade de encaixe** (Ctrl+Shift+', menu Exibir e seção Exibição da página) de 4 a 50 px, com pontos no canvas e encaixe ao desenhar, mover e redimensionar; Shift+setas anda um passo da grade.
- **Espaço entre os itens**: campos ↔ e ↕ no painel Design para aplicar um espaço igual entre vários objetos.
- **Estilo rápido**: oito combinações de preenchimento, contorno e cor do texto para formas e notas.
- **Conectar em sequência** (Ctrl+Alt+X, menu Organizar e clique direito).
- **Paletas de cores** da interface (Grafo, Bento, Sonda e Nexo, claras e escuras) no botão de paleta do topo.
- **Indicador de salvamento** na barra de status (Salvando…, Salvo às, Sincronizado, Offline, Não salvo) e o tamanho do objeto selecionado.
- **Página vazia** com atalhos para Novo quadro, Diagrama de texto, Tabela e Imagem.
- Servidor: **`GET /api/metrics`** no formato do Prometheus (salas, conexões, participantes, updates aplicados e recusados, bytes, limite de taxa e serviços disponíveis), protegido pelo `GRAFO_API_TOKEN` quando ele está definido.
- Testes de unidade, ponta a ponta e do servidor para todas as novidades (30 do editor, 22 cenários ponta a ponta e 27 do servidor).

### Alterado

- O tutorial rápido apresenta o diagrama a partir de texto, a busca e o indicador de salvamento.
- Manuais em PDF e README atualizados para a versão 1.3.0.

### Corrigido

- O Tab ativava a camada de acessibilidade do PixiJS sobre o canvas, que engolia o clique seguinte até o mouse se mexer.
- Botões do painel Design (itálico, alinhamento, estilos) só mostravam o estado novo na próxima seleção.
- Cada arquivo aberto deixava um ouvinte de saída da página registrado.

## [1.2.0] - 2026-11-03

### Adicionado

- **Novo quadro** (Arquivo → Novo quadro…, Ctrl+Alt+N): galeria com busca e miniaturas que abre um arquivo com o quadro já montado. Começar em branco ou numa **Aula** (da raiz para baixo, ramificações para os lados ou história ao contrário), **63 modelos** em dez categorias e **46 padrões de projeto** que abrem como diagrama ou como aula.
- **Aula**: Tab cria uma ramificação e Enter uma ideia irmã, com a árvore reorganizada na hora; seção **Aula** no painel Design para trocar o sentido e reorganizar.
- **Ações rápidas** (Ctrl+K ou Ctrl+P): busca qualquer comando dos menus, ferramenta, página, forma das bibliotecas, componente ou camada pelo nome, sem acento e em qualquer ordem de palavras; os últimos usados aparecem primeiro.
- **Medição de distâncias**: com algo selecionado, segure Alt para ver em pixels a distância até o objeto sob o mouse ou até as bordas do frame pai.
- **Conta-gotas** (I): aplica a cor no preenchimento, na cor do texto ou no contorno da seleção; sem seleção, copia o hexadecimal. Usa o conta-gotas do sistema no Chrome, no Edge e no app desktop.
- **Guias** puxadas das réguas, guardadas por página, com encaixe ao mover, desenhar e redimensionar; Shift+G mostra ou esconde e **Exibir → Remover guias da página** limpa.
- **Copiar e colar propriedades** (Ctrl+Alt+C e Ctrl+Alt+Shift+V).
- **Organizar em grade** (Ctrl+Alt+Shift+T), mantendo a ordem de leitura e um espaçamento igual.
- **Renomear** (F2), inclusive em lote, com `$n` para numerar e `$&` para repetir o nome atual.
- **Travar proporção** no painel Design, respeitada nos campos de largura e altura e nas alças.
- **Ajustar ao conteúdo** (Ctrl+Alt+Shift+R) para frames e seções.
- **Maiúsculas e minúsculas** na seção Texto: como foi digitado, MAIÚSCULAS, minúsculas ou Primeira Letra Maiúscula.
- **Copiar como PNG** (Ctrl+Shift+C e clique direito).
- **Trocar preenchimento e contorno** (Shift+X).
- **Busca no painel Camadas**, com o caminho de cada camada; Alt+L recolhe ou expande todas.
- Tab e Shift+Tab selecionam a próxima ou a anterior camada do mesmo nível.
- Ctrl+D repete o último deslocamento usado entre a original e a cópia.
- Botão **Tamanho original** para imagens.
- Testes de unidade e ponta a ponta para todas as novidades.

### Alterado

- **Espelhar** (Shift+H e Shift+V) inverte de verdade formas assimétricas, polígonos e imagens, espelha seleções com vários objetos como um conjunto e troca o lado dos conectores ligados.
- O tutorial rápido apresenta o conta-gotas e as ações rápidas.
- Manuais em PDF e README atualizados para a versão 1.2.0.

### Corrigido

- Abrir ou criar outro arquivo deixava o editor anterior ouvindo o teclado e o mouse e repetia o botão **Apresentar**; agora cada arquivo aberto libera o anterior por completo.
- Fechar um arquivo gerava um erro de canal entre abas ao avisar a saída da pessoa.
- Shift+C agora abre a aba **Comentários** na hora.
- Sombra com deslocamento vertical zero aparecia 4 px abaixo no canvas, diferente do arquivo exportado.

## [1.1.0] - 2026-10-24

### Adicionado

- App desktop para Windows: `Grafo.exe` abre o editor maximizado numa janela própria, sem servidor, sem navegador e sem instalador. F11 alterna a tela cheia, os arquivos ficam em `%LOCALAPPDATA%\Grafo` e a primeira abertura cria um atalho no menu Iniciar.
- No app desktop, Ctrl+S, **Salvar cópia `.grafo`** e **Exportar** abrem a janela **Salvar como** do Windows; o arquivo é gravado primeiro num temporário da mesma pasta.
- Tutorial rápido na primeira abertura, com nove passos sobre as ferramentas, os painéis, a navegação, a colaboração e o salvar. Dá para pular, e ele fica em **Ajuda → Tutorial rápido**.
- `desktop/` (código do app em Go com WebView2) e `scripts/build-desktop.mjs`, com build reproduzível e `--check`; `npm run desktop`.
- Testes ponta a ponta do tutorial e da ponte do app desktop; o CI gera o `Grafo.exe` de novo e compara byte a byte.

### Alterado

- O logo no canto superior esquerdo agora tem fundo branco e aparece com menos zoom; o favicon segue o mesmo desenho.
- A barra de status e a janela Sobre mostram **App desktop** quando o Grafo roda pelo `Grafo.exe`.
- Manuais em PDF atualizados para a versão 1.1.0.

## [1.0.1] - 2026-10-24

### Adicionado

- `index.html` na raiz: dois cliques abrem o Grafo na hora.
- `web/index.html` aberto direto do disco agora leva ao `Grafo.html`, em vez de ficar em "Carregando".

### Alterado

- O `Grafo.html` não tenta mais falar com o servidor quando é aberto por um endereço http, o que gerava um aviso no console.

## [1.0.0] - 2026-10-24

Primeira versão pública.

### Design

- Frames com recorte, raio e tamanhos prontos (celular, tablet, notebook, desktop, slide 16:9, A4, post e story), seções e grupos.
- Retângulo, elipse, linha, seta, polígono, estrela, imagem, caneta com curvas de Bézier, lápis suavizado, texto e nota adesiva.
- Auto layout horizontal e vertical com espaçamento, margem, alinhamento, distribuição, esticar, abraçar o conteúdo e posição absoluta.
- Restrições (esquerda, direita, centro, esticar e escala) para filhos de frames.
- Componentes e instâncias com substituições de texto e cor, restauração e desanexar.
- Estilos de cor e de texto com nome.
- Operações booleanas (união, subtração, interseção e exclusão) no núcleo C++.
- Preenchimento sólido, degradê linear e imagem; contorno com posição e tracejado; sombra, desfoque, opacidade e 16 modos de mistura.
- Guias inteligentes, encaixe em pixels, réguas, grade de pixels, minimapa, contornos e zoom de 2% a 25.600%.

### Diagramas

- 107 formas em oito bibliotecas: básicas, fluxograma, UML, entidade-relacionamento, BPMN, rede e nuvem, organograma e wireframe.
- Conectores reto, ortogonal (A* com desvio de formas) e curvo, presos a pontos de conexão, com rótulo e dez tipos de ponta.
- Contêineres (piscinas, raias, limites de rede, equipes e janelas) que levam as formas de dentro.
- Layout automático em camadas, de cima para baixo ou da esquerda para a direita.
- Fontes de dados em CSV, campos `{{coluna}}` no texto, cartões e organograma gerados a partir dos dados.

### Protótipo, colaboração e arquivos

- Links entre frames com transições e modo apresentação em tela cheia.
- Colaboração em tempo real com cursores, seleções e presença; desfazer só as próprias alterações.
- Comentários com respostas, resolver e reabrir; histórico de versões com restauração.
- Várias páginas, arquivos recentes, `.grafo`, importação de imagens, SVG e CSV, exportação PNG, JPG, SVG e PDF.
- Temas claro e escuro com a paleta do projeto.

### Plataforma

- Editor em JavaScript com PixiJS 8 (WebGL2 por padrão e WebGPU opcional) e Yjs.
- Núcleo geométrico em C++17 compilado para WebAssembly, com versões em JavaScript de todas as funções.
- Servidor em Rust (Tokio, Axum e Yrs) com PostgreSQL, Redis e NATS JetStream, que também roda só em memória.
- `Grafo.html`: o editor inteiro num arquivo só, que abre sem servidor e sem internet.
- Docker Compose, CI com testes do núcleo, do editor, ponta a ponta e do servidor, e licença de uso própria.
