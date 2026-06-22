run:
	go build -o compilerOnline
	./compilerOnline

docker-build:
	docker compose build

docker-up:
	docker compose up

docker-up-d:
	docker compose up -d

docker-down:
	docker compose down

docker-logs:
	docker compose logs -f