<p align="center">
  <img src="docs/images/logo.png" width="200" alt="Grafo">
</p>

<h1 align="center">Grafo<br><sub><sup><sup><sub>Copyright (©) 2026 Erik Pimenta</sub></sup></sup></sub></h1>

<p align="center">
  Editor colaborativo de design de interfaces e de diagramas que roda no navegador. Desenhe telas com frames, vetores, caneta, texto e imagens, organize com auto layout, restrições, componentes, estilos e operações booleanas, monte fluxogramas, UML, entidade-relacionamento, BPMN, redes e organogramas com conectores que desviam das formas, ligue os frames num protótipo clicável e edite tudo junto com outras pessoas, vendo os cursores em tempo real. Exporta PNG, JPG, SVG, PDF e o próprio arquivo <code>.grafo</code>.<br>
  Roda de duas maneiras: servidor completo com colaboração (Docker Compose) ou com dois cliques no <code>Grafo.html</code> (ou no <code>index.html</code>), sem instalar nada.<br>
  Pronto para baixar e usar.
</p>

<p align="center">
  JavaScript (módulos ES) · HTML5 · CSS3 · PixiJS 8 (WebGL2 e WebGPU) · C++17 → WebAssembly (Emscripten) · Rust (Tokio + Axum) · Yjs / Yrs + WebSockets · PostgreSQL 17 · Redis 7 · NATS JetStream · Docker Compose · Node Test Runner · Playwright
</p>

---

> **Manual completo:** [`Manual-Grafo.pdf`](Manual-Grafo.pdf) explica as maneiras de rodar, a tela, cada ferramenta e atalho, frames, auto layout, restrições, componentes, estilos, booleanas, as bibliotecas de formas, conectores, contêineres e raias, layout automático, dados em CSV e organograma, protótipo e apresentação, comentários, versões, colaboração, importação e exportação, a arquitetura, a API, a configuração, a segurança, os testes e a solução de problemas, passo a passo (cópia em [`docs/`](docs/Manual-Grafo.pdf)).

> **Banco de dados:** [`Banco-de-Dados-Grafo.pdf`](Banco-de-Dados-Grafo.pdf) traz o diagrama de relacionamentos geral e por domínio, todas as tabelas com campos, tipos, chaves e restrições, os tipos ENUM e índices, o ciclo de vida do documento colaborativo (update → sequência → compactação → versão), o formato binário Yrs, as chaves do Redis e os subjects do NATS, consultas prontas, como preparar o PostgreSQL e as regras de integridade, retenção e segurança dos dados.

> **Versão 1.0.1 (Atual):** o Grafo abre com dois cliques em qualquer HTML do projeto: o [`Grafo.html`](Grafo.html), o novo [`index.html`](index.html) da raiz ou o `web/index.html`, que agora leva direto ao editor em vez de ficar parado em "Carregando". Detalhes em [Arquivo único](#2-arquivo-único-grafohtml).

> **Versão 1.0.0:** primeira versão pública: design e diagramas no mesmo arquivo, 107 formas em oito bibliotecas, colaboração em tempo real pelo servidor Rust e o `Grafo.html` que abre sem instalar nada. Detalhes no [`CHANGELOG.md`](CHANGELOG.md).

<p align="center">
  <img src="docs/images/tela-editor.png" alt="Editor com duas telas de celular, um componente de botão e as notas, com páginas e camadas à esquerda e o painel Design à direita">
</p>

## O que o Grafo faz

- **Ferramentas de desenho:** mover, escala, frame, seção, retângulo, elipse, linha, seta, polígono, estrela, imagem, caneta com curvas de Bézier, lápis à mão livre (simplificado e suavizado no núcleo WebAssembly), texto, nota adesiva, conector, mão e comentário, todas com atalho de uma tecla. Shift trava proporção e ângulos, Alt desenha do centro e Ctrl desliga o encaixe.
- **Seleção e transformação:** clique, Shift + clique e seleção por área; oito alças de redimensionar, giro livre ou de 15° em 15°, **guias inteligentes** que encaixam bordas e centros, encaixe em pixels inteiros, setas para mover 1 ou 10 px, alinhar e distribuir, espelhar, agrupar, bloquear e ocultar.
- **Frames e auto layout:** frames com recorte, raio, preenchimento, contorno e efeitos, com tamanhos prontos (celular, tablet, notebook, desktop, slide 16:9, A4, post e story). O **auto layout** empilha os filhos na horizontal ou na vertical, com espaçamento, margem, alinhamento, distribuição, esticar e abraçar o conteúdo; fora dele, as **restrições** dizem o que cada filho faz quando o frame muda de tamanho.
- **Componentes e estilos:** transforme qualquer seleção em componente e crie instâncias que acompanham o principal, com **substituições** de texto e cor, restauração e desanexar. Estilos de cor e de texto com nome: editar o estilo muda todos os objetos que o usam.
- **Aparência:** cor sólida com opacidade, degradê linear, imagem (preencher, ajustar ou esticar), contorno dentro, no centro ou fora, contínuo, tracejado ou pontilhado, sombra projetada, desfoque, opacidade e **16 modos de mistura**. Texto com seis famílias, peso, tamanho, altura de linha, espaçamento, alinhamento horizontal e vertical, itálico e sublinhado.
- **Operações booleanas:** união, subtração, interseção e exclusão, calculadas no núcleo C++ e editáveis depois (as formas originais continuam dentro).
- **Diagramas:** **107 formas** em oito bibliotecas (básicas, fluxograma, UML, entidade-relacionamento, BPMN, rede e nuvem, organograma, wireframe e interface). Conectores **retos, ortogonais ou curvos** presos aos pontos de conexão, que desviam das outras formas pelo roteador A* do núcleo, com rótulo e dez tipos de ponta (inclusive pé-de-galinha do ER). Passe o mouse numa forma e puxe um ponto para ligar ou clonar.
- **Contêineres e layout automático:** piscinas, raias, limites de rede e equipes levam junto as formas de dentro. **Organizar → Layout automático** reorganiza o diagrama em camadas (Sugiyama) e anima as formas até o lugar.
- **Dados:** importe um CSV, ligue uma forma a uma linha e use `{{coluna}}` no texto; gere cartões ou um **organograma** inteiro (cartões, conectores e layout) a partir das colunas de id e gestor.
- **Protótipo e apresentação:** ligue qualquer objeto a um frame, escolha a transição e apresente em tela cheia, seguindo os links ou passando os frames como slides.
- **Colaboração em tempo real:** o documento é um CRDT (Yjs no editor, Yrs no servidor). Cada pessoa aparece no topo e com o próprio cursor no canvas, a seleção dos outros fica destacada na cor deles, e desfazer só desfaz o que é seu. Sem o servidor, as abas abertas do mesmo arquivo colaboram entre si.
- **Comentários e versões:** pinos de comentário com conversa, respostas, resolver e reabrir; versões nomeadas que voltam com um clique (e o Ctrl+Z desfaz a volta).
- **Arquivos:** várias páginas por arquivo, arquivos recentes, salvar e abrir `.grafo`, importar imagens e SVG (arrastando, colando ou pelo menu), colar texto vira texto, exportar PNG, JPG, SVG e PDF (um frame por página) e copiar como SVG.
- **Leve e fluido:** a tela só é redesenhada quando algo muda, zoom de 2% a 25.600% no ponto do cursor (roda, pinça ou teclado, com animação suave), réguas, minimapa, grade de pixels, temas claro e escuro e interface que some com Ctrl+\\.
- **Seguro por padrão:** Content-Security-Policy restrita sem `eval`, nenhum dado do usuário entra como HTML, SVG importado é limpo, o servidor limita tamanho e taxa, confere UUIDs e tipos de imagem pelos bytes e degrada sem cair quando falta um serviço. Detalhes em [Qualidade e segurança](#qualidade-e-segurança).

<p align="center">
  <img src="docs/images/tela-diagrama.png" width="49%" alt="Fluxograma de pedidos numa piscina, com decisão, documento, banco de dados, conectores ortogonais com rótulos e duas entidades ligadas por pé-de-galinha">
  <img src="docs/images/tela-bibliotecas.png" width="49%" alt="Aba Formas com o componente Botão e as bibliotecas de formas básicas e de fluxograma">
</p>

<p align="center">
  <img src="docs/images/tela-auto-layout.png" width="49%" alt="Cartão com auto layout vertical selecionado e a seção Auto layout no painel Design">
  <img src="docs/images/tela-componentes.png" width="49%" alt="Instância do botão com o texto substituído por Continuar e a seção Instância no painel">
</p>

## Design

### Frames, auto layout e restrições

- **Frame (F):** clique para um frame de 360×640 ou arraste para o tamanho que quiser; o painel Design traz os tamanhos prontos e a opção **Recortar conteúdo**. Objetos desenhados ou soltos dentro de um frame passam a ser filhos dele. **Seção (Shift+S)** organiza áreas da página.
- **Auto layout (Shift+A):** num frame, liga e desliga; numa seleção solta, cria o frame em volta, na direção em que os objetos já estão. No painel: direção (↓ ou →), espaçamento, margem, alinhamento no eixo cruzado (início, centro, fim, esticar), distribuição no eixo principal (início, centro, fim, espaçar) e abraçar o conteúdo em cada eixo. Textos com largura automática se ajustam sozinhos; marque **Posição absoluta** para tirar um filho do fluxo. Arraste um filho para reordenar.
- **Restrições:** para filhos de frames sem auto layout: esquerda, direita, centro, esticar ou escala na horizontal; topo, base, centro, esticar ou escala na vertical.

### Componentes, instâncias e estilos

| Ação | Como |
|---|---|
| Criar componente | Selecione e use **Objeto → Criar componente** (Ctrl+Alt+K) |
| Criar instância | Clique ou arraste o componente em **Formas → Componentes**, ou **Criar instância** no painel |
| Substituir texto ou cor | Campos da seção **Instância** no painel Design |
| Voltar ao original | **Restaurar substituições** |
| Ir ao principal | **Ir para o principal** (troca de página se precisar) |
| Desanexar | Ctrl+Alt+B: vira frame com cópias editáveis |
| Estilo de cor ou texto | Botão ✦ nas seções Preenchimento e Texto; editar o estilo de cor atualiza todos os objetos |

### Ferramentas e atalhos

| Ferramenta | Atalho | O que faz |
|---|---|---|
| Mover | V | Seleciona, move, redimensiona e gira; Ctrl + clique seleciona dentro de grupos |
| Escala | K | Redimensiona escalando também texto, contorno e raio |
| Frame / Seção | F / Shift+S | Prancheta com recorte / área nomeada |
| Retângulo / Elipse | R / O | Shift: quadrado e círculo; Alt: a partir do centro |
| Linha / Seta | L / Shift+L | Shift trava em 45° |
| Polígono / Estrela | Shift+Y / * | Lados, pontas e raio interno no painel |
| Imagem | Ctrl+Shift+K | PNG, JPEG, WebP, GIF ou SVG (também arrastando ou colando) |
| Caneta | P | Clique para retas, arraste para curvas, clique no primeiro ponto para fechar, Enter para terminar |
| Lápis | Shift+P | Mão livre, simplificado (Ramer–Douglas–Peucker) e suavizado em Bézier |
| Texto | T | Clique e digite; Esc termina |
| Nota adesiva | S | Nota colorida com sombra, já em edição |
| Conector | X | Arraste de uma forma a outra |
| Mão | H ou Espaço | Arrasta a visão (também com o botão do meio) |
| Comentário | C | Abre uma conversa no ponto clicado |

| Ação | Atalho |
|---|---|
| Desfazer / refazer | Ctrl+Z / Ctrl+Shift+Z ou Ctrl+Y |
| Copiar / recortar / colar / colar no lugar | Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+Shift+V |
| Duplicar | Ctrl+D ou Alt + arrastar |
| Agrupar / desagrupar / frame da seleção | Ctrl+G / Ctrl+Shift+G / Ctrl+Alt+G |
| Avançar / recuar / frente / trás | Ctrl+] / Ctrl+[ / Ctrl+Shift+] / Ctrl+Shift+[ |
| Alinhar esquerda / centro / direita | Alt+A / Alt+H / Alt+D |
| Alinhar topo / meio / base | Alt+W / Alt+V / Alt+S |
| Distribuir | Ctrl+Alt+H / Ctrl+Alt+V |
| Espelhar | Shift+H / Shift+V |
| Mostrar/ocultar / bloquear | Ctrl+Shift+H / Ctrl+Shift+L |
| Opacidade de 10% a 100% | 1 … 9, 0 |
| Layout automático do diagrama | Ctrl+Shift+Y |
| Zoom / ajustar tudo / seleção / 100% | Ctrl + roda, Ctrl++ e Ctrl+- / Shift+1 / Shift+2 / Shift+0 |
| Réguas / minimapa / grade / contornos | Shift+R / Shift+M / Ctrl+' / Ctrl+Shift+O |
| Salvar cópia .grafo / abrir / salvar versão | Ctrl+S / Ctrl+O / Ctrl+Alt+S |
| Exportar / apresentar | Ctrl+Shift+E / Ctrl+Alt+Enter |
| Ocultar interface / tema / atalhos | Ctrl+\\ / Alt+T / Ctrl+/ |

### Menus

| Menu | Comandos |
|---|---|
| Arquivo | Novo arquivo, abrir `.grafo`, arquivos recentes, salvar cópia `.grafo`, salvar versão, histórico de versões, importar imagem ou SVG, importar CSV, exportar |
| Editar | Desfazer, refazer, copiar, recortar, colar, duplicar, excluir, selecionar tudo, selecionar mesma cor e mesmo tipo |
| Exibir | Réguas, grade de pixels, minimapa, contornos, encaixe inteligente, encaixe em pixels, links de protótipo, render WebGPU, zoom, tema e ocultar interface |
| Objeto | Agrupar, desagrupar, frame da seleção, auto layout, criar componente, desanexar instância, booleanas, espelhar, bloquear, ocultar |
| Organizar | Ordem das camadas, alinhar, distribuir e layout automático do diagrama nas duas direções |
| Ajuda | Atalhos, seu nome e cor, sobre o Grafo |

O clique direito no canvas abre os comandos mais usados, inclusive **Colar aqui** e **Copiar como SVG**.

## Diagramas

| Biblioteca | Formas |
|---|---|
| Formas básicas (20) | Retângulo, arredondado, elipse, losango, triângulos, paralelogramo, trapézio, pentágono, hexágono, octógono, estrela, cruz, setas, divisa, nuvem, balão, coração e nota |
| Fluxograma (25) | Processo, decisão, início/fim, dados, processo predefinido, entrada e operação manual, documento(s), banco de dados, preparação, atraso, exibição, armazenamentos, conectores de página, junção, extração, ordenar, agrupar, soma, ou, limite de laço e anotação |
| UML (13) | Classe e interface com compartimentos, ator, caso de uso, componente, pacote, nota, estados, bifurcação, linha de vida e ativação |
| Entidade-relacionamento (5) | Entidade com PK e FK, entidade fraca, atributo, atributo chave e relacionamento |
| BPMN (11) | Tarefa, subprocesso, eventos de início, intermediário e fim, gateways exclusivo e paralelo, objeto e depósito de dados, piscina e raia |
| Rede e nuvem (16) | Servidor, base de dados, nuvem, usuário, notebook, celular, roteador, firewall, balanceador, fila, armazenamento, internet, contêiner, função, gateway de API e limite de rede |
| Organograma (3) | Cartão de pessoa, cargo e equipe |
| Wireframe e interface (14) | Botão, campo, caixa de seleção, interruptor, controle deslizante, lista suspensa, cartão, avatar, imagem, janela do navegador, tela de celular, barra de navegação, abas e etiqueta |

- **Conectores:** passe o mouse numa forma e puxe um dos quatro pontos até outra forma; clicar no ponto sem arrastar cria uma cópia da forma já ligada. O roteamento **ortogonal** usa A* numa grade de visibilidade esparsa, com penalidade de curvas e margem em volta das formas; o **curvo** sai na direção do lado escolhido; o **reto** liga direto. Pontas: nenhuma, seta, triângulo, losango, losango vazado, círculo, um, muitos, um ou muitos, zero ou muitos. Duplo clique edita o rótulo; arrastar as pontas troca a forma ligada; **Inverter** troca o sentido.
- **Contêineres:** o que é solto dentro de uma piscina, raia, limite de rede, equipe, janela de navegador ou tela de celular vira filho e se move junto.
- **Layout automático:** quebra de ciclos, camadas pelo caminho mais longo, ordenação por baricentro e coordenadas sem sobreposição, de cima para baixo ou da esquerda para a direita.

<p align="center">
  <img src="docs/images/tela-dados.png" width="49%" alt="Organograma gerado a partir de um CSV com sete pessoas e a aba Dados mostrando a tabela importada">
  <img src="docs/images/tela-prototipo.png" width="49%" alt="Link de protótipo do botão Começar até o frame Detalhes, com a aba Protótipo aberta">
</p>

## Colaboração, comentários e versões

<p align="center">
  <img src="docs/images/tela-colaboracao.png" width="49%" alt="Cursores de Clara e Bruno no canvas, com as seleções deles destacadas e os avatares no topo">
  <img src="docs/images/tela-comentarios.png" width="49%" alt="Conversa aberta sobre um pino de comentário, com resposta, e a aba Comentários listando as conversas da página">
</p>

- **Tempo real:** com o servidor, quem abre o mesmo link edita junto. Cada mudança vira um update binário de poucos bytes, que o servidor aplica, distribui para a sala, publica no NATS JetStream (para outras instâncias) e grava no PostgreSQL. Ao reconectar, o cliente manda o que fez offline e recebe só o que falta.
- **Presença:** nome e cor de cada pessoa no topo, cursor ao vivo e seleção destacada na cor dela; clique no avatar para ir até o cursor. **Compartilhar** mostra o link e deixa trocar o seu nome e a sua cor.
- **Comentários:** ferramenta C, Enter envia, Shift+Enter quebra a linha; respostas, resolver, reabrir e excluir; a aba **Comentários** lista as conversas da página.
- **Versões:** **Salvar versão** (Ctrl+Alt+S) e **Histórico de versões** com autor, data, tamanho e **Restaurar**.

<p align="center">
  <img src="docs/images/tela-versoes.png" width="49%" alt="Janela Histórico de versões com três versões salvas">
  <img src="docs/images/tela-escuro.png" width="49%" alt="O editor no tema escuro mostrando o fluxograma">
</p>

## Arquitetura

```text
Navegador
  Interface (HTML/CSS/JS) ──► Estado (Y.Doc + UndoManager) ──► Renderizador (PixiJS 8: WebGL2 ou WebGPU)
           │                          │                                   │
           │                          │                  Núcleo C++ → WebAssembly (rotas, booleanas, layout, curvas)
           │                          ▼
           │               IndexedDB (cópia local) · BroadcastChannel (abas)
           ▼
  WebSocket (protocolo y-websocket) + REST
           │
Servidor Rust (Tokio + Axum)
  Salas (um Yrs Doc por arquivo) ──► PostgreSQL 17 (estado, updates, versões, comentários, imagens, dados)
                                 ──► NATS JetStream (updates entre instâncias)
                                 ──► Redis 7 (presença, cache do estado, limite de taxa)
```

- **Editor (`web/src`):** `doc.js` guarda o documento num Y.Doc (mapas de páginas, nós, comentários, estilos, dados e imagens) e mantém um espelho em memória com índice de filhos e versão por nó, refeito só quando a estrutura muda; `render.js` transforma cada nó num objeto do PixiJS e só redesenha os que mudaram; `editor.js` cuida das ferramentas, do encaixe, do auto layout e dos comandos; `panels.js`, da interface; `export.js` gera SVG, PNG, JPG e PDF sem bibliotecas externas.
- **Núcleo (`engine/`):** C++17 sem biblioteca padrão, com alocador próprio, compilado para um `engine.wasm` de 37 KB sem imports. A ponte `web/src/engine/index.js` tem versões em JavaScript de todas as funções, usadas se o WebAssembly não carregar.
- **Servidor (`server/`):** Axum com WebSocket, salas em memória com Yrs, compactação do estado a cada 200 updates, descarte de salas vazias, cabeçalhos de segurança e arquivos estáticos do editor. Cada serviço externo é opcional: sem eles, o servidor roda em memória e avisa no log.

### Como o documento é guardado

Cada objeto é um mapa com `id`, `type`, `page`, `parent`, `z` (ordem) e as propriedades (`x`, `y`, `w`, `h`, `rotation`, `fill`, `stroke`, `text`, `layout`, `from`/`to` nos conectores, `componentId` nas instâncias…). As coordenadas são absolutas na página; frames, grupos e contêineres apontam os filhos pelo `parent`. No servidor, o estado vai para `document_states` (binário Yrs v1) e os updates entre compactações para `document_updates`, com número de sequência; as versões nomeadas ficam em `versions`. O esquema completo está no [`Banco-de-Dados-Grafo.pdf`](Banco-de-Dados-Grafo.pdf) e em [`server/migrations`](server/migrations/0001_init.sql).

## Como rodar

| Maneira | Para quem | Colaboração | Onde salva |
|---|---|---|---|
| 1. Servidor completo (Docker Compose) | Equipes, uso em rede | Em tempo real, entre computadores | PostgreSQL (e uma cópia no navegador) |
| 2. Dois cliques no HTML (`Grafo.html` ou `index.html`) | Uso individual, sem instalar nada | Entre abas do mesmo navegador | Navegador (IndexedDB) e arquivos `.grafo` |

### 1. Servidor completo

#### Com Docker

```bash
git clone https://github.com/ravelroot/Collaborative-Design-and-Diagram-Editor.git
cd Collaborative-Design-and-Diagram-Editor
cp .env.example .env
docker compose up -d --build
```

Troque `POSTGRES_PASSWORD` no `.env` antes de subir. Abra `http://localhost:8080`. O Compose sobe `postgres`, `redis`, `nats` (com JetStream) e `grafo`; a imagem compila o núcleo com o Emscripten, empacota o editor e o servidor Rust, roda como usuário sem privilégios, com sistema de arquivos somente leitura. As migrações rodam na primeira inicialização. Para ver o estado: `curl http://localhost:8080/api/health`.

#### Sem Docker

```bash
npm ci
npm run build
cd server
GRAFO_STATIC_DIR=../web/dist cargo run --release
```

Requisitos: Node.js 22+, Rust 1.85+ e, para recompilar o núcleo, Emscripten 4 (`bash engine/build.sh`; sem o Emscripten, o mesmo script usa o clang com alvo wasm32). Sem `DATABASE_URL`, `REDIS_URL` e `NATS_URL`, o servidor sobe só em memória.

#### Só o editor (Node.js)

```bash
npm ci
npm run build
npm run serve
```

Abre em `http://localhost:5173`, salva no navegador e as abas do mesmo arquivo colaboram entre si.

### 2. Arquivo único (Grafo.html)

Baixe o [`Grafo.html`](Grafo.html) e abra com dois cliques. O editor inteiro, com o núcleo WebAssembly embutido, abre sem servidor e sem internet, com uma Content-Security-Policy que só deixa rodar o próprio script (conferido por hash SHA-256) e bloqueia qualquer conexão de rede. Os arquivos ficam em **Arquivo → Arquivos recentes** e podem ser salvos e abertos como `.grafo`.

| Arquivo | O que acontece ao dar dois cliques |
|---|---|
| `Grafo.html` | Abre o editor inteiro |
| `index.html` (raiz) | Abre o `Grafo.html` na hora |
| `web/index.html` | Abre o `Grafo.html` (em vez de esperar pelo build) |

Funciona no Chrome, no Edge, no Firefox e no Safari, inclusive em pastas com espaço no nome, como `C:\Users\Seu Nome\Desktop`. Para levar para outro computador, basta copiar o `Grafo.html`.

## Usando a API

Estado do servidor e dos serviços:

```bash
curl http://localhost:8080/api/health
```

Criar um arquivo (com `GRAFO_API_TOKEN` definido no `.env`):

```bash
curl -X POST http://localhost:8080/api/files \
  -H "Authorization: Bearer $GRAFO_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Fluxo de cadastro","kind":"diagram"}'
```

Listar as versões de um arquivo:

```bash
curl http://localhost:8080/api/files/<id>/versions
```

| Método e rota | Para quê |
|---|---|
| `GET /api/health` | Estado do servidor, do PostgreSQL, do Redis e do NATS |
| `GET`, `POST /api/files` | Listar e criar arquivos (o POST aceita o `id` gerado no editor e é idempotente) |
| `GET`, `PATCH`, `DELETE /api/files/{id}` | Ler, renomear, mudar o tipo e excluir |
| `GET`, `POST /api/files/{id}/versions` | Listar e criar versões |
| `GET /api/files/{id}/versions/{vid}` | Baixar o estado binário (Yrs v1) |
| `POST /api/files/{id}/versions/{vid}/restore` | Restaurar uma versão no documento ao vivo |
| `GET`, `POST /api/files/{id}/comments` · `PATCH …/comments/{cid}` | Comentários; resolver e reabrir |
| `POST /api/files/{id}/assets` · `GET /api/assets/{aid}` | Imagens até 20 MB, tipo conferido pelos bytes e sem duplicar (SHA-256) |
| `GET`, `PUT /api/files/{id}/data-sources` | Fontes de dados (CSV) |
| `GET /ws/{file_id}` | Sala de colaboração: protocolo do `y-websocket` (sincronização, presença e pedido de presença) |

## Formato `.grafo`

O arquivo `.grafo` é JSON e guarda o projeto inteiro:

```json
{
  "format": "grafo",
  "version": 1,
  "name": "App de entregas",
  "pages": ["p1"],
  "pageInfo": { "p1": { "id": "p1", "name": "Telas", "bg": "" } },
  "nodes": {
    "n1": { "id": "n1", "type": "frame", "page": "p1", "parent": null, "z": 1, "x": 0, "y": 0, "w": 390, "h": 844, "fill": { "type": "solid", "color": "#FAF6EF", "alpha": 1 } }
  },
  "comments": {}, "styles": {}, "dataSources": {}, "assets": {}
}
```

Tipos de nó: `frame`, `section`, `group`, `rect`, `ellipse`, `polygon`, `star`, `path`, `text`, `image`, `sticky`, `shape` (com `shape` igual ao id da forma da biblioteca), `connector`, `component`, `instance` e `boolean`. As imagens ficam em `assets` como data URL.

## Configuração

| Variável | Padrão | O que controla |
|---|---|---|
| `GRAFO_BIND` | `0.0.0.0:8080` | Endereço e porta do servidor |
| `DATABASE_URL` | — | PostgreSQL; sem ela, só memória |
| `REDIS_URL` | — | Redis; sem ela, presença e limite em memória |
| `NATS_URL` | — | NATS JetStream; sem ela, uma instância só |
| `GRAFO_STATIC_DIR` | `web/dist` | Pasta do editor empacotado |
| `GRAFO_API_TOKEN` | — | Se definido (24+ caracteres), exige `Authorization: Bearer` nas escritas REST e `?token=` no WebSocket |
| `GRAFO_MAX_UPDATE_BYTES` | `8388608` | Tamanho máximo de um update |
| `GRAFO_SNAPSHOT_EVERY` | `200` | Updates entre compactações |
| `GRAFO_RATE_LIMIT` | `120` | Requisições por minuto por IP |
| `GRAFO_ROOM_IDLE_SECS` | `60` | Segundos até descarregar uma sala vazia |
| `GRAFO_TRUST_PROXY` | `false` | Lê o IP do `X-Forwarded-For` atrás de proxy confiável |
| `RUST_LOG` | `info` | Nível de log |

No `.env` do Compose também ficam `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` e `GRAFO_PORT`. No editor, o renderizador WebGPU liga em **Exibir → Render WebGPU** ou com `?render=webgpu` no endereço; o padrão é o WebGL2, que funciona em todos os navegadores atuais.

## Banco de dados

| Tabela | O que guarda |
|---|---|
| `users`, `teams`, `team_members`, `projects` | Pessoas, equipes, papéis (`owner`, `editor`, `commenter`, `viewer`) e projetos |
| `files`, `file_permissions`, `share_links` | Arquivos (design, diagrama ou quadro), permissões e links de compartilhamento |
| `document_states` | Estado compactado de cada arquivo (Yrs v1), vetor de estado e última sequência |
| `document_updates` | Updates desde a última compactação, em ordem (`file_id`, `seq`) |
| `versions` | Versões nomeadas com o estado completo |
| `comments` | Conversas e respostas presas a uma página e a um ponto |
| `assets` | Imagens por arquivo, sem duplicar (SHA-256) |
| `library_components` | Componentes publicados como biblioteca |
| `data_sources` | Fontes de dados (CSV) em JSONB |

Diagramas, campos, restrições, índices e consultas prontas estão no [`Banco-de-Dados-Grafo.pdf`](Banco-de-Dados-Grafo.pdf).

## Desenvolvimento e testes

| Comando | O que faz |
|---|---|
| `npm ci` | Instala as dependências do editor |
| `npm test` | Testes do núcleo WASM e do editor (Node Test Runner) |
| `npm run build` | Empacota o editor em `web/dist` |
| `npm run portable` | Gera o `Grafo.html` |
| `npm run test:e2e` | Testes ponta a ponta no Chromium (Playwright) |
| `cargo test` e `cargo clippy --all-targets -- -D warnings` (em `server/`) | Testes e análise do servidor |

| Suíte | O que cobre | Resultado |
|---|---|---|
| Núcleo C++/WASM (33 testes) | Entradas degeneradas e NaN, fuzz de 300 pares de polígonos nas quatro booleanas, rota com 500 obstáculos, índice com 10.000 caixas conferido contra força bruta, layout com 300 nós e 400 arestas, memória estável em 5.000 rodadas, WASM e JavaScript com o mesmo resultado | Rota com 500 obstáculos em 0,9 a 35 ms; 1.000 consultas no índice em 6 ms |
| Editor (15 testes) | Calculadora dos campos, CSV, as 107 formas em vários tamanhos, geometria, conectores ortogonais, desfazer só o que é seu, `.grafo` de ida e volta, três réplicas com 600 edições concorrentes entregues fora de ordem | As réplicas convergem; com 20.000 objetos, 200 consultas de filhos levam cerca de 10 ms |
| Ponta a ponta (9 cenários) | GPU e WASM ativos, desenhar, duplicar, desfazer, refazer, mover, conectar, texto, auto layout, componente, booleana, exportação SVG e PDF, duas abas colaborando, 3.000 objetos e nenhum erro de JavaScript | Quadro com 3.000 objetos abaixo de 50 ms de CPU |
| Servidor (24 testes) | Protocolo, UUID, limites, limite de taxa, convergência, reconexão depois de 25 updates perdidos, mensagens malformadas, 50 clientes numa sala e 20 salas em paralelo | 50 clientes convergem em 80 ms; 1.000 updates em 20 salas em 288 ms |

O CI (GitHub Actions) roda tudo a cada push, compila o núcleo com o Emscripten, confere se o `Grafo.html` está em dia com o código e constrói a imagem Docker.

## Qualidade e segurança

- **Navegador:** CSP sem `unsafe-eval` (o PixiJS roda no modo sem `eval` e os campos numéricos usam uma calculadora própria), `connect-src` limitado ao próprio servidor e `frame-ancestors 'none'`. Nomes de arquivos, páginas, camadas, comentários e textos entram sempre como texto, nunca como HTML. SVG importado perde scripts, eventos e referências externas e entra como imagem. Arquivos `.grafo` inválidos são recusados sem tocar no documento aberto.
- **Servidor:** UUID validado em todas as rotas, limite de tamanho por update e por imagem, tipo de imagem conferido pelos bytes, limite de requisições por IP (429 com `Retry-After`), token de API comparado em tempo constante, links de leitura que não gravam, mensagens que o Yrs não decodifica derrubam só a conexão que as mandou, e CSP com sandbox nas imagens servidas. A imagem Docker roda sem root, sem capacidades e com sistema de arquivos somente leitura.
- **Dados:** o CRDT garante que todos convergem para o mesmo documento, em qualquer ordem de chegada; o desfazer de cada pessoa só mexe nas próprias alterações; o editor guarda uma cópia local no IndexedDB a cada mudança, e o servidor compacta o estado e mantém os updates com número de sequência para recuperar depois de uma queda.
- **Desempenho:** a renderização só acontece quando algo muda; os objetos fora da tela não são desenhados; a árvore de filhos, a ordem de desenho e a versão de cada nó ficam em índices que só se refazem quando a estrutura muda, e o PixiJS só redesenha os nós alterados.

### Estrutura

```text
Grafo.html                  o editor inteiro num arquivo só, que abre sem servidor (gerado)
index.html                  abre o Grafo.html com dois cliques
web/                        editor
  index.html, css/, img/    página, estilos com a paleta e logo
  boot.js                   leva ao Grafo.html quando o index.html é aberto direto do disco
  src/                      módulos: documento, render, editor, painéis, exportação, apresentação e exemplo
  src/engine/               ponte JavaScript do núcleo WebAssembly, com versões em JavaScript
  assets/engine.wasm        núcleo compilado (gerado)
engine/                     núcleo geométrico em C++17 (include/, src/, build.sh, CMakeLists.txt)
server/                     servidor em Rust (src/, migrations/, tests/)
scripts/                    build do editor (esbuild), do Grafo.html e servidor estático
tests/js/                   testes do núcleo e do editor
tests/e2e/                  testes ponta a ponta (Playwright)
docs/                       manuais em PDF e imagens do README
.github/workflows/          CI
Dockerfile, docker-compose.yml, .env.example
```

### Componentes de terceiros

O Grafo depende de componentes com licenças próprias, que continuam valendo para cada um deles:

| Componente | Uso no projeto | Licença |
|---|---|---|
| [PixiJS](https://pixijs.com/) | Renderização com WebGL2 e WebGPU | MIT |
| [Yjs](https://github.com/yjs/yjs), [y-websocket](https://github.com/yjs/y-websocket), [y-protocols](https://github.com/yjs/y-protocols), [lib0](https://github.com/dmonad/lib0) | Documento colaborativo e protocolo no editor | MIT |
| [Yrs](https://github.com/y-crdt/y-crdt) | Documento colaborativo no servidor | MIT |
| [Tokio](https://tokio.rs/), [Axum](https://github.com/tokio-rs/axum), [tower-http](https://github.com/tower-rs/tower-http) | Servidor assíncrono, rotas e WebSocket | MIT |
| [SQLx](https://github.com/launchbadge/sqlx) | Acesso ao PostgreSQL | MIT ou Apache-2.0 |
| [redis-rs](https://github.com/redis-rs/redis-rs) | Cliente do Redis | BSD-3-Clause |
| [async-nats](https://github.com/nats-io/nats.rs) | Cliente do NATS JetStream | Apache-2.0 |
| [Serde](https://serde.rs/), [uuid](https://github.com/uuid-rs/uuid), [chrono](https://github.com/chronotope/chrono), [sha2](https://github.com/RustCrypto/hashes), [tracing](https://github.com/tokio-rs/tracing), [DashMap](https://github.com/xacrimon/dashmap) | Serialização, identificadores, datas, hash, logs e mapas concorrentes | MIT ou Apache-2.0 |
| [esbuild](https://esbuild.github.io/) | Empacotamento do editor (só no build) | MIT |
| [Emscripten](https://emscripten.org/) | Compilação do núcleo para WebAssembly (só no build) | MIT ou UIUC |
| [Playwright](https://playwright.dev/) | Testes ponta a ponta (só no desenvolvimento) | Apache-2.0 |

PostgreSQL, Redis e NATS rodam como serviços externos via Docker e não são redistribuídos neste repositório; cada um segue a licença da própria imagem. A interface usa as fontes do sistema e ícones desenhados no próprio código.

## Licença

Copyright (©) 2026 Erik Pimenta. Todos os direitos reservados.

O Grafo é distribuído sob uma [licença de uso](LICENSE) própria:

| Pode | Não pode |
|---|---|
| Baixar e usar de graça, como servidor completo, só o editor ou com dois cliques no `Grafo.html` | Modificar o Grafo ou criar versões derivadas |
| Configurar pelo `.env` e pelas preferências, estilos e bibliotecas do editor | Copiar o código, no todo ou em parte, para outros projetos |
| Usar como quiser o que você cria ou exporta, inclusive em projetos comerciais | Redistribuir, publicar ou vender o Grafo |

Para pedir uma autorização que a licença não dá, fale com o autor pelo [GitHub](https://github.com/ravelroot). O texto completo está em [`LICENSE`](LICENSE).
