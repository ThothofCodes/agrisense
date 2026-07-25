FROM python:3.11-slim
RUN addgroup --system agrisense && adduser --system --group agrisense
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt || \
    pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p models && chown -R agrisense:agrisense /app
USER agrisense
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=10s CMD python -c "import httpx; httpx.get('http://localhost:8000/health')" || exit 1
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
