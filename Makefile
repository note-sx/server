.PHONY: build-app docker dev clean help

# 检测包管理器 (优先使用 pnpm，否则使用 npm)
NPM := $(shell command -v pnpm >/dev/null 2>&1 && echo pnpm || echo npm)

# 获取版本号
VERSION := $(shell cd app && $(NPM) pkg get version 2>/dev/null | xargs || echo "1.0.0")
IMAGE_NAME := ghcr.io/kinboyw/share-note-server
DOCKER_IMAGE := $(IMAGE_NAME):$(VERSION)

help: ## 显示帮助信息
	@echo "可用的命令:"
	@echo "  make build-app  - 构建应用 (编译 TypeScript)"
	@echo "  make docker     - 构建 Docker 镜像 (依赖 build-app)"
	@echo "  make dev        - 启动开发环境 (依赖 docker)"
	@echo "  make clean      - 清理构建产物"
	@echo ""
	@echo "当前版本: $(VERSION)"
	@echo "Docker 镜像: $(DOCKER_IMAGE)"

build-app: ## 构建应用
	@echo "构建应用 (使用 $(NPM))..."
	cd app && $(NPM) run build
	@echo "构建完成!"

docker: build-app ## 构建 Docker 镜像
	@echo "构建 Docker 镜像: $(DOCKER_IMAGE)"
	docker build \
		--build-arg PACKAGE_VERSION=$(VERSION) \
		-t $(DOCKER_IMAGE) \
		-t $(IMAGE_NAME):latest \
		.
	@echo "Docker 镜像构建完成: $(DOCKER_IMAGE)"

dev: docker ## 启动开发环境
	@echo "启动开发环境..."
	@if docker compose version >/dev/null 2>&1; then \
		docker compose up -d; \
	else \
		docker-compose up -d; \
	fi
	@echo "开发环境已启动!"
	@echo "服务运行在 http://localhost:3000"

clean: ## 清理构建产物
	@echo "清理构建产物..."
	rm -rf app/dist
	@echo "清理完成!"

