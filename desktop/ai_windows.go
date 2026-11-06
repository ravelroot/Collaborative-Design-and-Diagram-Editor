package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unsafe"

	webview2 "github.com/jchv/go-webview2"
	"golang.org/x/sys/windows"
)

const (
	aiFile         = "ai.dat"
	aiMaxRequest   = 256 << 10
	aiMaxResponse  = 4 << 20
	aiMaxTokens    = 16000
	aiTimeout      = 170 * time.Second
	aiDefaultLimit = 8192
)

type aiProvider struct {
	kind string
	base string
	key  bool
}

var aiProviders = map[string]aiProvider{
	"anthropic":  {"anthropic", "https://api.anthropic.com", true},
	"openai":     {"openai", "https://api.openai.com/v1", true},
	"gemini":     {"openai", "https://generativelanguage.googleapis.com/v1beta/openai", true},
	"openrouter": {"openai", "https://openrouter.ai/api/v1", true},
	"ollama":     {"openai", "http://localhost:11434/v1", false},
	"lmstudio":   {"openai", "http://localhost:1234/v1", false},
}

type aiSettings struct {
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Key      string `json:"key,omitempty"`
}

type aiStatus struct {
	Configured bool   `json:"configured"`
	Provider   string `json:"provider"`
	Kind       string `json:"kind"`
	Model      string `json:"model"`
}

type aiAnswer struct {
	Status int    `json:"status,omitempty"`
	Body   string `json:"body,omitempty"`
	Error  string `json:"error,omitempty"`
}

type aiStore struct {
	mu   sync.Mutex
	path string
}

func bindAI(w webview2.WebView, dir string) {
	store := &aiStore{path: filepath.Join(dir, aiFile)}
	must(w.Bind("__grafoAIStatus", func() aiStatus {
		return store.status()
	}))
	must(w.Bind("__grafoAISave", func(cfg aiSettings) error {
		return store.save(cfg)
	}))
	must(w.Bind("__grafoAIClear", func() error {
		return store.clear()
	}))
	must(w.Bind("__grafoAIRequest", func(id int, body string) {
		go func() {
			payload, _ := json.Marshal(store.request(body))
			w.Dispatch(func() {
				w.Eval(fmt.Sprintf("window.__grafoAIDone && window.__grafoAIDone(%d, %s)", id, payload))
			})
		}()
	}))
}

const aiScript = `
  const aiPending = new Map();
  let aiNext = 0;
  window.__grafoAIDone = (id, answer) => {
    const done = aiPending.get(id);
    if (!done) return;
    aiPending.delete(id);
    done(answer || { error: 'Resposta vazia do app desktop' });
  };
  const ai = Object.freeze({
    status: () => window.__grafoAIStatus(),
    save: (cfg) => window.__grafoAISave({ provider: String(cfg.provider || ''), model: String(cfg.model || ''), key: String(cfg.key || '') }),
    clear: () => window.__grafoAIClear(),
    request: (body) =>
      new Promise((resolve) => {
        const id = ++aiNext;
        aiPending.set(id, resolve);
        Promise.resolve(window.__grafoAIRequest(id, String(body))).catch((error) => {
          aiPending.delete(id);
          resolve({ error: String((error && error.message) || error) });
        });
      }),
  });
`

func protect(data []byte, decrypt bool) ([]byte, error) {
	if len(data) == 0 {
		return nil, errors.New("dados vazios")
	}
	in := windows.DataBlob{Size: uint32(len(data)), Data: &data[0]}
	var out windows.DataBlob
	var err error
	if decrypt {
		err = windows.CryptUnprotectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	} else {
		err = windows.CryptProtectData(&in, nil, nil, 0, nil, windows.CRYPTPROTECT_UI_FORBIDDEN, &out)
	}
	if err != nil {
		return nil, err
	}
	defer windows.LocalFree(windows.Handle(unsafe.Pointer(out.Data)))
	return bytes.Clone(unsafe.Slice(out.Data, out.Size)), nil
}

func (s *aiStore) load() (aiSettings, error) {
	var cfg aiSettings
	sealed, err := os.ReadFile(s.path)
	if err != nil {
		return cfg, err
	}
	plain, err := protect(sealed, true)
	if err != nil {
		return cfg, errors.New("não foi possível abrir a chave da IA guardada neste computador")
	}
	err = json.Unmarshal(plain, &cfg)
	return cfg, err
}

func (s *aiStore) status() aiStatus {
	s.mu.Lock()
	defer s.mu.Unlock()
	cfg, err := s.load()
	p, ok := aiProviders[cfg.Provider]
	if err != nil || !ok {
		return aiStatus{}
	}
	return aiStatus{Configured: cfg.Model != "" && (!p.key || cfg.Key != ""), Provider: cfg.Provider, Kind: p.kind, Model: cfg.Model}
}

func (s *aiStore) save(cfg aiSettings) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := aiProviders[cfg.Provider]
	if !ok {
		return errors.New("provedor de IA desconhecido")
	}
	cfg.Model = strings.TrimSpace(cfg.Model)
	cfg.Key = strings.TrimSpace(cfg.Key)
	if cfg.Model == "" || len(cfg.Model) > 200 || len(cfg.Key) > 1000 {
		return errors.New("modelo ou chave inválidos")
	}
	if cfg.Key == "" && p.key {
		if old, err := s.load(); err == nil && old.Provider == cfg.Provider {
			cfg.Key = old.Key
		}
	}
	if !p.key {
		cfg.Key = ""
	}
	plain, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	sealed, err := protect(plain, false)
	if err != nil {
		return errors.New("o Windows não conseguiu proteger a chave")
	}
	return writeFileSafely(s.path, sealed)
}

func (s *aiStore) clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.Remove(s.path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}

func (s *aiStore) request(body string) aiAnswer {
	s.mu.Lock()
	cfg, err := s.load()
	s.mu.Unlock()
	p, ok := aiProviders[cfg.Provider]
	if err != nil || !ok || cfg.Model == "" || (p.key && cfg.Key == "") {
		return aiAnswer{Error: "Configure o provedor e a chave da IA no painel IA."}
	}
	if len(body) > aiMaxRequest {
		return aiAnswer{Error: "Pedido à IA grande demais."}
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return aiAnswer{Error: "Pedido à IA inválido."}
	}
	if _, ok := payload["messages"].([]any); !ok {
		return aiAnswer{Error: "Pedido à IA inválido."}
	}
	limit := float64(aiDefaultLimit)
	if v, ok := payload["max_tokens"].(float64); ok && v >= 1 {
		limit = v
	}
	if limit > aiMaxTokens {
		limit = aiMaxTokens
	}
	payload["model"] = cfg.Model
	payload["max_tokens"] = int(limit)
	delete(payload, "stream")
	data, err := json.Marshal(payload)
	if err != nil {
		return aiAnswer{Error: "Pedido à IA inválido."}
	}
	endpoint := p.base + "/chat/completions"
	if p.kind == "anthropic" {
		endpoint = p.base + "/v1/messages"
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return aiAnswer{Error: "Endereço do provedor inválido."}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "Grafo-Desktop/"+version)
	if p.kind == "anthropic" {
		req.Header.Set("anthropic-version", "2023-06-01")
		req.Header.Set("x-api-key", cfg.Key)
	} else if cfg.Key != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.Key)
	}
	res, err := (&http.Client{Timeout: aiTimeout}).Do(req)
	if err != nil {
		if !p.key {
			return aiAnswer{Error: "Não foi possível falar com o programa de IA local. Confira se ele está aberto."}
		}
		return aiAnswer{Error: "Não foi possível falar com o provedor de IA. Confira a conexão com a internet."}
	}
	defer res.Body.Close()
	answer, err := io.ReadAll(io.LimitReader(res.Body, aiMaxResponse+1))
	if err != nil || len(answer) > aiMaxResponse {
		return aiAnswer{Error: "Resposta da IA incompleta ou grande demais."}
	}
	return aiAnswer{Status: res.StatusCode, Body: string(answer)}
}
