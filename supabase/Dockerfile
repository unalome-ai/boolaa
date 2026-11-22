# Use the official Supabase CLI image
FROM supabase/cli:latest

# Set working directory
WORKDIR /workspace

# Copy schema.sql into the container
COPY schema.sql /workspace/schema.sql

# Expose default Supabase ports
EXPOSE 54321 54322 54323

# Start Supabase local stack and apply schema
CMD ["start", "--debug"] 