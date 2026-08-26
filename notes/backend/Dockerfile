FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# The notebook itself is a bind mount; this is only the default target so the
# image is runnable on its own.
ENV NOTEBOOK_DIR=/notebook
VOLUME ["/notebook"]

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
