import { buildServer } from "./server";

const PORT = parseInt(process.env.PORT ?? "3001", 10);

buildServer()
  .then((server) => {
    server.listen({ port: PORT, host: "0.0.0.0" }, (err) => {
      if (err) {
        server.log.error(err);
        process.exit(1);
      }
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
