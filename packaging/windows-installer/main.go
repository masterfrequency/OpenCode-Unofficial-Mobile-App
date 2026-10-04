package main

import (
	"crypto/rand"
	"embed"
	"encoding/hex"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

//go:embed payload/gateway/*
var payload embed.FS

func main() {
	fmt.Println("OpenCode Unofficial Gateway Setup 1.0.0")
	missing := []string{}
	for _, command := range []string{"opencode", "node", "tailscale", "powershell"} {
		if _, err := exec.LookPath(command); err != nil { missing = append(missing, command) }
	}
	if len(missing) > 0 { fatal("Install these requirements first: " + strings.Join(missing, ", ")) }
	root := filepath.Join(os.Getenv("LOCALAPPDATA"), "OpenCode-Unofficial-Gateway")
	if root == "OpenCode-Unofficial-Gateway" { fatal("LOCALAPPDATA is unavailable") }
	if err := os.MkdirAll(root, 0700); err != nil { fatal(err.Error()) }
	entries, err := fs.ReadDir(payload, "payload/gateway")
	if err != nil { fatal(err.Error()) }
	for _, entry := range entries {
		if entry.IsDir() { continue }
		data, readErr := payload.ReadFile("payload/gateway/" + entry.Name())
		if readErr != nil { fatal(readErr.Error()) }
		if writeErr := os.WriteFile(filepath.Join(root, entry.Name()), data, 0600); writeErr != nil { fatal(writeErr.Error()) }
	}
	tokenFile := filepath.Join(root, ".gateway-token")
	if _, err := os.Stat(tokenFile); os.IsNotExist(err) {
		secret := make([]byte, 32); if _, err = rand.Read(secret); err != nil { fatal(err.Error()) }
		if err = os.WriteFile(tokenFile, []byte(hex.EncodeToString(secret)), 0600); err != nil { fatal(err.Error()) }
	}
	installTask := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filepath.Join(root, "install-windows-task.ps1"))
	installTask.Dir = root
	if output, err := installTask.CombinedOutput(); err != nil { fmt.Printf("Automatic startup warning: %s\n%s\n", err, strings.TrimSpace(string(output))) }
	cmd := exec.Command("powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", filepath.Join(root, "start.ps1"))
	cmd.Dir = root
	if err := cmd.Start(); err != nil { fatal("Could not start gateway: " + err.Error()) }
	if output, err := exec.Command("tailscale", "serve", "--bg", "localhost:4174").CombinedOutput(); err != nil { fatal("Could not configure Tailscale Serve: " + strings.TrimSpace(string(output))) }
	tailscaleStatus, _ := exec.Command("tailscale", "serve", "status").CombinedOutput()
	codeFile := filepath.Join(root, ".pairing-code")
	for i := 0; i < 40; i++ {
		if code, err := os.ReadFile(codeFile); err == nil {
			fmt.Printf("\nGateway installed in %s\nPairing code: %s\n\nTailscale Serve:\n%s\n", root, strings.TrimSpace(string(code)), strings.TrimSpace(string(tailscaleStatus)))
			fmt.Println("Keep this window open for the first test. Press Enter to close setup; the gateway continues running.")
			fmt.Scanln(); return
		}
		time.Sleep(250 * time.Millisecond)
	}
	fatal("Gateway started, but the pairing code was not created. Check the gateway PowerShell window.")
}

func fatal(message string) { fmt.Fprintln(os.Stderr, "Setup failed:", message); fmt.Println("Press Enter to close."); fmt.Scanln(); os.Exit(1) }
