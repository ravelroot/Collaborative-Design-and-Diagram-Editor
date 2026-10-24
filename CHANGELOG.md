# Changelog

Todas as mudanças importantes do Grafo ficam registradas aqui.

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
