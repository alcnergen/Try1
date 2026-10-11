# Hazır 3B model

`app/3d/canta.glb` bu klasördeki `build.js` ile prosedürel olarak üretilir (three.js + GLTFExporter, tarayıcıda çalışır).

```bash
npx http-server -p 8090 .             # depo kökünden
# Tarayıcıda http://localhost:8090/tools/model3d/build.html açın ve konsolda:
#   await buildGlb()   → base64 GLB döner; dosyaya yazıp app/3d/canta.glb ile değiştirin
# Önizleme: http://localhost:8090/tools/model3d/preview.html
```

Başka bir hazır model kullanmak için GLB dosyasını `app/3d/canta.glb` yerine koymanız yeterli.
