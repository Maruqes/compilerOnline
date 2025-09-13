package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/containerd/containerd"
	"github.com/containerd/containerd/cio"
	"github.com/containerd/containerd/containers"
	seccomp "github.com/containerd/containerd/contrib/seccomp"
	"github.com/containerd/containerd/namespaces"
	"github.com/containerd/containerd/oci"
	specs "github.com/opencontainers/runtime-spec/specs-go"
)

var ErrLimitChar5k = fmt.Errorf("code exceeds 5000 character limit")

// Global cached containerd client and base image
var (
	ctrdClient *containerd.Client
	clientOnce sync.Once
	clientErr  error

	baseImage   containerd.Image
	imagePulled bool
	imageMu     sync.Mutex
)

func getContainerdClient() (*containerd.Client, error) {
	clientOnce.Do(func() {
		ctrdClient, clientErr = containerd.New("/run/containerd/containerd.sock")
	})
	return ctrdClient, clientErr
}

func ensureBaseImage(ctx context.Context, ref string) (containerd.Image, bool, error) {
	imageMu.Lock()
	defer imageMu.Unlock()
	if imagePulled {
		return baseImage, true, nil
	}
	c, err := getContainerdClient()
	if err != nil {
		return nil, false, err
	}
	img, err := c.Pull(ctx, ref, containerd.WithPullUnpack)
	if err != nil {
		return nil, false, err
	}
	baseImage = img
	imagePulled = true
	return baseImage, false, nil
}

// sandboxSpecOpt returns a SpecOpt applying mounts, limits, and hardening.
func sandboxSpecOpt() oci.SpecOpts {
	return func(ctx context.Context, client oci.Client, c *containers.Container, s *specs.Spec) error {
		// mounts already added by caller; enforce limits & rlimits if not present
		if s.Linux == nil {
			s.Linux = &specs.Linux{}
		}
		s.Linux.Resources = &specs.LinuxResources{
			CPU: &specs.LinuxCPU{
				Shares: func() *uint64 { v := uint64(256); return &v }(),
				Quota:  func() *int64 { v := int64(10000); return &v }(),
				Period: func() *uint64 { v := uint64(100000); return &v }(),
			},
			Memory: &specs.LinuxMemory{
				Limit: func() *int64 { v := int64(128 * 1024 * 1024); return &v }(),
				Swap:  func() *int64 { v := int64(128 * 1024 * 1024); return &v }(),
			},
			Pids: &specs.LinuxPids{Limit: 64},
		}
		if s.Process == nil {
			s.Process = &specs.Process{}
		}
		s.Process.Rlimits = []specs.POSIXRlimit{
			{Type: "RLIMIT_CPU", Hard: 4, Soft: 4},
			{Type: "RLIMIT_FSIZE", Hard: 8 << 20, Soft: 8 << 20},
			{Type: "RLIMIT_NOFILE", Hard: 256, Soft: 256},
			{Type: "RLIMIT_NPROC", Hard: 64, Soft: 64},
			{Type: "RLIMIT_STACK", Hard: 8 << 20, Soft: 8 << 20},
		}
		return nil
	}
}

func buildExecutionScript(code string) (string, error) {
	if len(code) > 5000 {
		return "", ErrLimitChar5k
	}
	delim := "LANGCODE_EOF"
	if strings.Contains(code, delim) {
		delim = fmt.Sprintf("LANGCODE_EOF_%d", time.Now().UnixNano())
	}
	script := fmt.Sprintf(`set -euo pipefail
TMPDIR=$(mktemp -d /tmp/sandbox-XXXX)
cp -r /lang/compiler $TMPDIR/
cp -r /lang/liblang $TMPDIR/ 2>/dev/null || true
cp -r /lang/*.lang $TMPDIR/ 2>/dev/null || true
cd $TMPDIR
cat > test.lang <<'%s'
%s
%s
chown $(id -u):$(id -g) test.lang || true
chmod +x compiler 2>/dev/null || true
./compiler test.lang out
echo "----exec-out----"
./out || true
cd /
rm -rf "$TMPDIR"`, delim, code, delim)
	return script, nil
}

// execInKata executes code inside a short-lived Kata container returning combined output,
// the container ID (unique sandbox ID), and an error if execution failed or timed out.
func execInKata(code string) (string, string, error) {
	overallStart := time.Now()
	phaseStart := overallStart
	script, err := buildExecutionScript(code)
	if err != nil {
		return "", "", err
	}
	fmt.Printf("[timing] build script: %v\n", time.Since(phaseStart))
	phaseStart = time.Now()
	//ask for sudo if not root
	if os.Geteuid() != 0 {
		sudoPath, lookErr := exec.LookPath("sudo")
		if lookErr != nil {
			return "", "", fmt.Errorf("need root or sudo not found: %w", lookErr)
		}
		args := append([]string{"-E", os.Args[0]}, os.Args[1:]...)
		cmd := exec.Command(sudoPath, args...)
		cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
		if runErr := cmd.Run(); runErr != nil {
			return "", "", fmt.Errorf("sudo elevation failed: %w", runErr)
		}
		return "", "", nil
	}

	// connect (or reuse) containerd client
	clientStart := phaseStart
	client, err := getContainerdClient()
	if err != nil {
		return "", "", fmt.Errorf("containerd client: %w", err)
	}
	fmt.Printf("[timing] get/reuse containerd client: %v\n", time.Since(clientStart))
	phaseStart = time.Now()

	// namespace context
	ctx := namespaces.WithNamespace(context.Background(), "compiler")
	// ensure base image once
	ensureStart := phaseStart
	img, cached, pullErr := ensureBaseImage(ctx, "docker.io/library/ubuntu:24.04")
	if pullErr != nil {
		return "", "", fmt.Errorf("ensure image: %w", pullErr)
	}
	if cached {
		fmt.Printf("[timing] ensure image (cached): %v\n", time.Since(ensureStart))
	} else {
		fmt.Printf("[timing] ensure image (pulled): %v\n", time.Since(ensureStart))
	}
	phaseStart = time.Now()

	//working directory and lang dir
	wd, err := os.Getwd()
	if err != nil {
		return "", "", fmt.Errorf("getwd: %w", err)
	}
	langDir := filepath.Join(wd, "lang")
	if fi, statErr := os.Stat(langDir); statErr != nil || !fi.IsDir() {
		return "", "", fmt.Errorf("missing lang directory at %s", langDir)
	}
	fmt.Printf("[timing] prep env: %v\n", time.Since(phaseStart))
	phaseStart = time.Now()

	uniqueID := fmt.Sprintf("kata-sandbox-%d", time.Now().UnixNano())

	specOpts := []oci.SpecOpts{
		oci.WithImageConfig(img),
		oci.WithProcessArgs("/bin/bash", "-lc", script),
		oci.WithEnv([]string{
			"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
			"HOME=/home/sandbox",
			"LANG=C",
			"LC_ALL=C",
		}),
		oci.WithHostname("sandbox"),
		oci.WithMounts([]specs.Mount{
			{Destination: "/tmp", Type: "tmpfs", Source: "tmpfs", Options: []string{"rw", "nosuid", "nodev", "mode=1777", "size=64m"}},
			{Type: "bind", Source: langDir, Destination: "/lang", Options: []string{"rbind", "ro"}},
		}),
		oci.WithNoNewPrivileges,
		oci.WithCapabilities([]string{}),
		oci.WithMaskedPaths([]string{"/proc/kcore", "/proc/timer_list", "/proc/sched_debug", "/proc/scsi", "/sys/firmware", "/sys/fs/selinux"}),
		oci.WithReadonlyPaths([]string{"/proc/asound", "/proc/bus", "/proc/fs", "/proc/irq", "/proc/sys", "/proc/sysrq-trigger"}),
		sandboxSpecOpt(),
		seccomp.WithDefaultProfile(),
		oci.WithRootFSReadonly(),
		oci.WithUser("1000:1000"),
	}

	container, err := client.NewContainer(
		ctx,
		uniqueID,
		containerd.WithNewSnapshot(uniqueID+"-snap", img),
		containerd.WithNewSpec(specOpts...),
		containerd.WithRuntime("io.containerd.kata.v2", nil),
	)
	if err != nil {
		return "", uniqueID, fmt.Errorf("create container: %w", err)
	}
	defer func() { _ = container.Delete(ctx, containerd.WithSnapshotCleanup) }()
	fmt.Printf("[timing] create container: %v\n", time.Since(phaseStart))
	phaseStart = time.Now()

	// capture stdout/stderr
	stdoutBuf := &bytes.Buffer{}
	stderrBuf := &bytes.Buffer{}
	task, err := container.NewTask(ctx, cio.NewCreator(cio.WithStreams(nil, stdoutBuf, stderrBuf)))
	if err != nil {
		return "", uniqueID, fmt.Errorf("new task: %w", err)
	}
	defer func() { _, _ = task.Delete(ctx) }()

	statusC, err := task.Wait(ctx)
	if err != nil {
		return "", uniqueID, fmt.Errorf("wait task: %w", err)
	}
	if err := task.Start(ctx); err != nil {
		return "", uniqueID, fmt.Errorf("start task: %w", err)
	}
	fmt.Printf("[timing] start task: %v\n", time.Since(phaseStart))
	phaseStart = time.Now()

	// wall clock timeout enforcement (configured via env, default set in main)
	timeout := kataExecTimeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}
	collect := func() string {
		// combine stdout and stderr; limit size to avoid OOM
		const max = 64 * 1024
		out := stdoutBuf.String()
		errS := stderrBuf.String()
		if len(out) > max {
			out = out[:max] + "...[truncated]"
		}
		if len(errS) > 0 {
			if len(errS) > max {
				errS = errS[:max] + "...[truncated]"
			}
			out = out + "\n[stderr]\n" + errS
		}
		return out
	}
	select {
	case <-statusC:
		fmt.Printf("[timing] wait task (success): %v\n", time.Since(phaseStart))
		fmt.Printf("[timing] total: %v\n", time.Since(overallStart))
		return collect(), uniqueID, nil
	case <-time.After(timeout):
		_ = task.Kill(ctx, syscall.SIGTERM, containerd.WithKillAll)
		select {
		case <-statusC:
			fmt.Printf("[timing] wait task (timeout SIGTERM): %v\n", time.Since(phaseStart))
			fmt.Printf("[timing] total: %v\n", time.Since(overallStart))
			return collect(), uniqueID, fmt.Errorf("execution exceeded %s (terminated with SIGTERM)", timeout)
		case <-time.After(2 * time.Second):
			_ = task.Kill(ctx, syscall.SIGKILL, containerd.WithKillAll)
			<-statusC
			fmt.Printf("[timing] wait task (timeout SIGKILL): %v\n", time.Since(phaseStart))
			fmt.Printf("[timing] total: %v\n", time.Since(overallStart))
			return collect(), uniqueID, fmt.Errorf("execution exceeded %s (forced SIGKILL)", timeout)
		}
	}
}

// timing wrapper removed
