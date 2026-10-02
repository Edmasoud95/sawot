# Pinned upstream multi-platform Python image; updates require rebuilding/verifying.
FROM python:3.12-slim@sha256:f77ac9e44ae96ef2c90b8053ea08c31f8be030f824196b0ae4db6d462c84e51f
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MPLBACKEND=Agg
COPY requirements.lock /opt/requirements.lock
RUN pip install --no-cache-dir --require-hashes --only-binary=:all: -r /opt/requirements.lock \
 && rm -rf /tmp /var/tmp /root/.cache \
 && mkdir -m 1777 /tmp && ln -s /work/tmp /var/tmp \
 && ln -s /work/outputs /outputs \
 && mkdir /inputs /work
USER 65532:65532
WORKDIR /work
ENTRYPOINT ["/usr/local/bin/python3", "-I", "-B"]
