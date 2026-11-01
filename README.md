# Hub RI: dados públicos

Arquivos de dados que o aplicativo Hub RI baixa para se atualizar sem precisar de um APK novo.
Contêm apenas listas de vagas com link para o anúncio oficial de cada organização. Nenhum dado de usuário, chave ou código privado.

- `vagas.json`: vagas escolhidas pelo Hub. Atualizado por uma rotina que lê o resultado da pesquisa, confere formato e links e só então grava.
- O app aceita só o formato validado e usa a lista embutida no APK quando está sem internet.
- Confirme sempre no anúncio oficial antes de se candidatar.
