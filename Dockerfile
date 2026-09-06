FROM python:3.11-slim

WORKDIR /app

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PORT=8000

# Install dependencies
COPY car_insurance_inspector/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY car_insurance_inspector/ car_insurance_inspector/
COPY run.py run.py

# Expose port
EXPOSE 8000

# Launch server
CMD ["python", "run.py"]
