FROM node:lts
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && apt-get clean
WORKDIR /app
COPY package*.json ./
RUN npm install && npm cache clean --force
COPY . .
EXPOSE 10000
ENV NODE_ENV production
CMD ["npm", "start"]
